<?php
declare(strict_types=1);
require_once __DIR__ . '/theme-source.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$interval = max(60, min(86400, (int)(getenv('BOKE_THEME_INTERVAL') ?: 300)));
$result = ['enabled' => strtolower(getenv('BOKE_THEME_SYNC') ?: 'true') !== 'false', 'interval' => $interval, 'status' => 'fallback', 'theme' => null];
if ($result['enabled']) {
    try {
        $deadline = microtime(true) + 10;
        $cache = boke_cached(sys_get_temp_dir() . '/boke-theme-v1', $interval, static function ($previous) use ($deadline) {
            return boke_refresh($previous, static fn($url, $head) => boke_fetch($url, $head, $deadline));
        });
        $result['theme'] = $cache['theme'] ?? null;
        $result['status'] = $cache['status'] ?? 'fallback';
        $result['checkedAt'] = isset($cache['checked']) ? gmdate('c', $cache['checked']) : null;
    } catch (Throwable $error) {
        // The bundled theme remains fully usable even without curl, DOM or writable cache.
    }
}
echo json_encode($result, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
