<?php
declare(strict_types=1);
require __DIR__ . '/../backend/claude-risk-core.php';
$checks = 0;
function check(bool $condition, string $message): void {
    global $checks;
    $checks++;
    if (!$condition) throw new RuntimeException($message);
}
$clean = ['ip' => '8.8.8.8', 'is_vpn' => false, 'is_proxy' => false, 'is_tor' => false,
    'is_abuser' => false, 'is_datacenter' => false]; // Synthetic flags, not claims about this address.
$score = fn($patch) => bokeRiskAssessment(array_replace($clean, $patch), '8.8.8.8');
check($score([])['score'] === 100, 'Complete clean fixture');
check($score(['is_vpn' => true, 'is_datacenter' => true])['score'] === 65, 'VPN + datacenter example');
check($score(['is_vpn' => true, 'is_proxy' => true, 'is_tor' => true])['score'] === 40, 'No triple-counting correlated signals');
check($score(['is_tor' => true, 'is_abuser' => true, 'is_datacenter' => true])['score'] === 0, 'Worst case bounded at zero');
check($score(['is_crawler' => true])['score'] === 100, 'Crawler is informational');
check($score(['company' => ['abuser_score' => '0.9 (Very High)']])['score'] === 100, 'Network abuse ratio is not individual abuse');
check($score(['location' => ['country_code' => 'CN']])['score'] === 100, 'Region does not alter IP reputation score');
foreach (['is_vpn', 'is_proxy', 'is_tor', 'is_abuser', 'is_datacenter'] as $field) {
    foreach ([null, 'false', 0, [], 'true'] as $value) {
        check($score([$field => $value])['score'] === null, "Unknown/invalid $field must not be clean");
    }
}
check(bokeRiskAssessment(['ip' => '8.8.8.8'], '8.8.8.8')['score'] === null, 'Anonymous-tier response does not score');
foreach (['8.8.8.9', 'not-an-ip'] as $different) {
    try { $score(['ip' => $different]); throw new RuntimeException('IP mismatch accepted'); }
    catch (UnexpectedValueException $expected) { $checks++; }
}
foreach (['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '255.255.255.255', '::1', 'fd00::1', 'fe80::1', '::ffff:8.8.8.8', '2001:db8::1', 'https://example.com', '8.8.8.8/path', ['8.8.8.8'], null] as $ip) {
    check(bokeRiskPublicIp($ip) === null, 'Reject reserved/private/non-IP input: ' . json_encode($ip));
}
check(bokeRiskPublicIp('8.8.8.8') === '8.8.8.8', 'Public IPv4');
check(bokeRiskPublicIp('2606:4700:4700:0:0:0:0:1111') === '2606:4700:4700::1111', 'Canonical IPv6');
$v6 = array_replace($clean, ['ip' => '2606:4700:4700:0:0:0:0:1111']);
check(bokeRiskAssessment($v6, '2606:4700:4700::1111')['score'] === 100, 'Equivalent IPv6 accepted');
echo json_encode(['status' => 'passed', 'checks' => $checks]), "\n";
