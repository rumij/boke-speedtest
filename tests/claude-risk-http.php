<?php
declare(strict_types=1);
// Run inside a --network none container. The only HTTP connection is loopback.
$root = dirname(__DIR__);
$temp = sys_get_temp_dir() . '/boke-risk-test-' . bin2hex(random_bytes(6));
mkdir($temp, 0700);
putenv('BOKE_IPAPI_KEY=offline-fixture-key');
putenv('BOKE_RISK_STATE_DIR=' . $temp);
putenv('BOKE_RISK_DAILY_LIMIT=900');
$command = [PHP_BINARY, '-d', 'auto_prepend_file=' . __DIR__ . '/claude-risk-provider-fixture.php', '-S', '127.0.0.1:18123', '-t', $root];
$server = proc_open($command, [0 => ['pipe', 'r'], 1 => ['file', $temp . '/server.log', 'w'], 2 => ['file', $temp . '/server.log', 'a']], $pipes);
if (!is_resource($server)) throw new RuntimeException('Local fixture server failed');
$checks = 0;
function checkHttp(bool $value, string $message): void { global $checks; $checks++; if (!$value) throw new RuntimeException($message); }
function requestRisk(): array {
    $context = stream_context_create(['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json',
        'content' => '{"ip":"8.8.8.8"}', 'ignore_errors' => true, 'timeout' => 3]]);
    $raw = file_get_contents('http://127.0.0.1:18123/backend/claude-risk.php', false, $context);
    preg_match('/HTTP\/\S+ (\d+)/', $http_response_header[0], $match);
    checkHttp(!str_contains($raw, 'offline-fixture-key'), 'Never return provider key');
    return [(int) $match[1], json_decode($raw, true)];
}
function fixture(string $mode): void {
    global $temp;
    @unlink($temp . '/state.json'); @unlink($temp . '/calls');
    file_put_contents($temp . '/fixture-mode', $mode);
}
try {
    for ($i = 0; $i < 30; $i++) {
        $socket = @fsockopen('127.0.0.1', 18123, $errno, $message, .1);
        if ($socket) { fclose($socket); break; }
        usleep(50000);
    }
    fixture('valid');
    [$status, $result] = requestRisk();
    checkHttp($status === 200 && $result['score'] === 65, 'Live handler + offline provider success: ' . json_encode([$status, $result]));
    [$status, $result] = requestRisk();
    checkHttp($status === 200 && $result['cache_hit'] === true, 'Cached result');
    checkHttp(count(file($temp . '/calls')) === 1, 'One provider request for repeated IP');
    for ($i = 0; $i < 3; $i++) requestRisk();
    checkHttp(requestRisk()[0] === 429, 'Per-client minute rate limit includes cached reads');
    foreach (['partial' => 200, 'mismatch' => 502, 'invalid' => 502, 'oversize' => 502, '401' => 503, '403' => 503, '429' => 429, '503' => 502] as $mode => $expected) {
        fixture((string) $mode);
        [$status, $result] = requestRisk();
        checkHttp($status === $expected, "Provider $mode returns $expected");
        if ($mode === 'partial') checkHttp($result['score'] === null, 'Partial provider data never scored');
        if (in_array((string) $mode, ['401', '403', '429'], true)) {
            requestRisk();
            checkHttp(count(file($temp . '/calls')) === 1, 'Provider limit triggers circuit break');
        }
    }
    fixture('valid');
    file_put_contents($temp . '/state.json', json_encode(['day' => gmdate('Y-m-d'), 'used' => 900, 'cache' => []]));
    checkHttp(requestRisk()[0] === 429, 'Daily budget enforced before provider');
    checkHttp(!file_exists($temp . '/calls'), 'Daily quota rejection makes zero provider requests');
    fixture('valid');
    $lock = fopen($temp . '/state.lock', 'c+'); flock($lock, LOCK_EX);
    checkHttp(requestRisk()[0] === 503, 'Concurrent provider work returns busy without waiting');
    flock($lock, LOCK_UN); fclose($lock);
    fixture('valid');
    file_put_contents($temp . '/state.json', 'corrupt-state');
    checkHttp(requestRisk()[0] === 503, 'Corrupt quota state fails closed');
    file_put_contents($temp . '/state.json', '');
    checkHttp(requestRisk()[0] === 503, 'Empty existing state cannot reset quota');
    echo json_encode(['status' => 'passed', 'checks' => $checks]), "\n";
} finally {
    proc_terminate($server); proc_close($server);
    foreach (glob($temp . '/*') as $file) unlink($file);
    rmdir($temp);
}
