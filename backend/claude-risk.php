<?php
declare(strict_types=1);
require_once __DIR__ . '/claude-risk-core.php';
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function bokeRiskReply(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function bokeRiskKey(): string
{
    $file = getenv('BOKE_IPAPI_KEY_FILE');
    if (is_string($file) && $file !== '') {
        $value = @file_get_contents($file, false, null, 0, 1025);
        return is_string($value) && strlen($value) <= 1024 ? trim($value) : '';
    }
    return trim((string) getenv('BOKE_IPAPI_KEY'));
}

$key = bokeRiskKey();
$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method === 'GET') {
    bokeRiskReply(200, ['configured' => $key !== '', 'provider' => 'ipapi.is', 'rule_version' => 'boke-ip-v1']);
}
if ($method !== 'POST') {
    header('Allow: GET, POST');
    bokeRiskReply(405, ['error' => 'method', 'message' => '请使用页面上的检测按钮。']);
}
if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') {
    bokeRiskReply(415, ['error' => 'content_type', 'message' => '请求格式不正确。']);
}
$input = file_get_contents('php://input', false, null, 0, 513);
if ($input === false || strlen($input) > 512) {
    bokeRiskReply(413, ['error' => 'size', 'message' => '请求过大。']);
}
$body = json_decode($input, true);
$ip = is_array($body) ? bokeRiskPublicIp($body['ip'] ?? null) : null;
if ($ip === null) bokeRiskReply(400, ['error' => 'ip', 'message' => '请输入有效的公网 IPv4 或 IPv6 地址。']);
if ($key === '') bokeRiskReply(503, ['error' => 'not_configured', 'message' => '已取得待查 IP，站点尚未配置免费 IP 风险数据 Key，暂时无法评分。']);

// One bounded state file outside the web root. Nonblocking lock also limits
// upstream concurrency to one; requests are never automatically retried.
$directory = getenv('BOKE_RISK_STATE_DIR') ?: sys_get_temp_dir() . '/boke-claude-risk';
if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
    bokeRiskReply(503, ['error' => 'storage', 'message' => '评分服务的缓存目录不可写。']);
}
$handle = @fopen($directory . '/state.lock', 'c');
if ($handle === false || !flock($handle, LOCK_EX | LOCK_NB)) {
    header('Retry-After: 10');
    bokeRiskReply(503, ['error' => 'busy', 'message' => '评分服务忙，请稍后手动重试。']);
}
$exists = file_exists($directory . '/state.json');
$stored = $exists ? @file_get_contents($directory . '/state.json', false, null, 0, 1048577) : '';
$state = !$exists ? [] : json_decode($stored ?: '', true);
if (!is_array($state) || strlen($stored ?: '') > 1048576) {
    bokeRiskReply(503, ['error' => 'storage', 'message' => '评分服务状态异常，需要管理员检查。']);
}
$now = time();
$day = gmdate('Y-m-d');
if (($state['day'] ?? null) !== $day) $state = ['day' => $day, 'used' => 0, 'cache' => []];
if (($state['minute'] ?? null) !== intdiv($now, 60)) {
    $state['minute'] = intdiv($now, 60);
    $state['requests'] = 0;
    $state['clients'] = [];
}
$client = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
if ($state['requests'] >= 30 || ($state['clients'][$client] ?? 0) >= 5) {
    header('Retry-After: 60');
    bokeRiskReply(429, ['error' => 'rate_limit', 'message' => '本分钟查询次数已达上限，请稍后手动重试。']);
}
$state['requests']++;
$state['clients'][$client] = ($state['clients'][$client] ?? 0) + 1;
$state['cache'] = array_filter($state['cache'] ?? [], fn($item) => is_array($item) && ($item['expires'] ?? 0) > $now);

function bokeRiskSave(array $state): void
{
    global $directory;
    $encoded = json_encode($state, JSON_INVALID_UTF8_SUBSTITUTE);
    // Lock identity stays stable while an atomic rename replaces the state.
    // An interrupted write must not truncate the quota counter back to zero.
    $temporary = $directory . '/state-' . bin2hex(random_bytes(8)) . '.tmp';
    if ($encoded === false || @file_put_contents($temporary, $encoded) !== strlen($encoded) || !@rename($temporary, $directory . '/state.json')) {
        @unlink($temporary);
        bokeRiskReply(503, ['error' => 'storage', 'message' => '评分服务无法保存额度状态。']);
    }
}

$cacheId = hash('sha256', $ip);
if (isset($state['cache'][$cacheId])) {
    $result = $state['cache'][$cacheId]['result'];
    $result['cache_hit'] = true;
    bokeRiskSave($state);
    bokeRiskReply(200, $result);
}
$budget = filter_var(getenv('BOKE_RISK_DAILY_LIMIT'), FILTER_VALIDATE_INT);
$budget = $budget === false ? 900 : max(1, min(1000, $budget));
if (($state['cooldown_until'] ?? 0) > $now || $state['used'] >= $budget) {
    bokeRiskSave($state);
    header('Retry-After: 3600');
    bokeRiskReply(429, ['error' => 'quota', 'message' => '数据源额度或服务限制已触发，本站已暂停新查询。已有缓存仍可使用。']);
}
// Reserve before the network request: failures and process interruption cannot
// repeatedly consume unaccounted provider quota.
$state['used']++;
bokeRiskSave($state);
$context = stream_context_create(['http' => [
    'method' => 'POST', 'header' => "Content-Type: application/json\r\nAccept: application/json\r\nConnection: close\r\n",
    'content' => json_encode(['q' => $ip, 'key' => $key]),
    'timeout' => 8, 'ignore_errors' => true, 'follow_location' => 0,
], 'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
// Fixed provider URL; neither target URLs nor credentials are accepted from users.
$raw = @file_get_contents('https://api.ipapi.is/', false, $context, 0, 32769);
$statusLine = $http_response_header[0] ?? '';
preg_match('/^HTTP\/\S+\s+(\d{3})/', $statusLine, $statusMatch);
$status = (int) ($statusMatch[1] ?? 0);
if ($status === 429 || $status === 401 || $status === 403) {
    $state['cooldown_until'] = $status === 429 ? strtotime('tomorrow UTC') : $now + 300;
    bokeRiskSave($state);
    bokeRiskReply($status === 429 ? 429 : 503, ['error' => 'provider_limit', 'message' => '数据源拒绝查询，请管理员检查 Key 或额度；本次不会自动重试。']);
}
if ($raw === false || $status !== 200 || strlen($raw) > 32768) {
    bokeRiskReply(502, ['error' => 'provider', 'message' => '风险数据源暂时不可用，无法评分；请稍后手动重试。']);
}
$data = json_decode($raw, true);
try {
    if (!is_array($data)) throw new UnexpectedValueException('Invalid provider JSON');
    $result = bokeRiskAssessment($data, $ip);
} catch (UnexpectedValueException $error) {
    bokeRiskReply(502, ['error' => 'provider_data', 'message' => '数据源返回的 IP 或内容不匹配，已停止评分。']);
}
// Do not cache incomplete responses as clean. Keep a bounded 256-IP cache.
if ($result['score'] !== null) {
    if (count($state['cache']) >= 256) array_shift($state['cache']);
    $state['cache'][$cacheId] = ['expires' => $now + 3600, 'result' => $result];
    bokeRiskSave($state);
}
bokeRiskReply(200, $result);
