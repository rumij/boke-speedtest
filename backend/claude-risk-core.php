<?php
// Local, explainable heuristics. These weights are not Anthropic's risk model.
declare(strict_types=1);

function bokeRiskPublicIp(mixed $value): ?string
{
    if (!is_string($value) || strlen($value) > 45) return null;
    $ip = filter_var(trim($value), FILTER_VALIDATE_IP, FILTER_FLAG_GLOBAL_RANGE);
    if ($ip === false) return null;
    // Reject IPv4-mapped IPv6 to avoid ambiguous classification/cache identities.
    $packed = inet_pton($ip);
    if (strlen($packed) === 16 && substr($packed, 0, 12) === str_repeat("\0", 10) . "\xff\xff") return null;
    return inet_ntop($packed);
}

function bokeRiskText(mixed $value): string
{
    return is_string($value) ? substr($value, 0, 200) : '';
}

function bokeRiskAssessment(array $data, string $ip): array
{
    if (!isset($data['ip']) || !is_string($data['ip']) || @inet_pton($data['ip']) !== @inet_pton($ip)) {
        throw new UnexpectedValueException('Provider IP mismatch');
    }
    if (isset($data['error']) || ($data['is_bogon'] ?? false) === true) {
        throw new UnexpectedValueException('Provider did not return usable public IP data');
    }
    $signals = [];
    foreach (['is_vpn', 'is_proxy', 'is_tor', 'is_abuser', 'is_datacenter', 'is_crawler'] as $field) {
        $signals[$field] = isset($data[$field]) && is_bool($data[$field]) ? $data[$field] : null;
    }
    $required = ['is_vpn', 'is_proxy', 'is_tor', 'is_abuser', 'is_datacenter'];
    $known = count(array_filter($required, fn($field) => $signals[$field] !== null));
    // Related anonymity signals are grouped: Tor + proxy + VPN never triple-count.
    $anonymous = max($signals['is_tor'] === true ? 60 : 0,
        $signals['is_proxy'] === true ? 35 : 0, $signals['is_vpn'] === true ? 20 : 0);
    $deductions = [
        ['name' => '匿名网络标记', 'points' => $anonymous,
            'detail' => 'Tor −60、公开代理 −35、VPN −20；同时命中只取最高一项。'],
        ['name' => '该 IP 的滥用标记', 'points' => $signals['is_abuser'] === true ? 25 : 0,
            'detail' => '仅使用该 IP 的 is_abuser；不把整个运营商的滥用比例当作个人记录。'],
        ['name' => '数据中心标记', 'points' => $signals['is_datacenter'] === true ? 15 : 0,
            'detail' => '数据源标记为机房时减 15；这不代表违规，也不证明其他地址是住宅。'],
    ];
    $score = $known === count($required) ? max(0, 100 - array_sum(array_column($deductions, 'points'))) : null;
    $location = is_array($data['location'] ?? null) ? $data['location'] : [];
    $asn = is_array($data['asn'] ?? null) ? $data['asn'] : [];
    $company = is_array($data['company'] ?? null) ? $data['company'] : [];
    return [
        'ip' => $ip, 'provider' => 'ipapi.is', 'rule_version' => 'boke-ip-v1',
        'score' => $score, 'known' => $known, 'required' => count($required),
        'level' => $score === null ? 'unknown' : ($score >= 80 ? 'low' : ($score >= 50 ? 'medium' : 'high')),
        'label' => $score === null ? '数据不足' : ($score === 100 ? '未命中所查风险' : ($score >= 80 ? '较少风险信号' : ($score >= 50 ? '存在风险信号' : '较多风险信号'))),
        'signals' => $signals, 'deductions' => $deductions,
        'country' => bokeRiskText($location['country'] ?? null),
        'country_code' => bokeRiskText($location['country_code'] ?? null),
        'city' => bokeRiskText($location['city'] ?? null),
        'asn' => isset($asn['asn']) && is_int($asn['asn']) ? 'AS' . $asn['asn'] : '',
        'organization' => bokeRiskText($asn['org'] ?? $company['name'] ?? null),
        'queried_at' => gmdate('c'), 'cache_hit' => false,
    ];
}
