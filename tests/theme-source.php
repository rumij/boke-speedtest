<?php
declare(strict_types=1);
require __DIR__ . '/../frontend/theme-source.php';

function check(bool $condition, string $label): void {
    if (!$condition) throw new RuntimeException($label);
}
function rejected(callable $call): void {
    try { $call(); } catch (RuntimeException $error) { return; }
    throw new RuntimeException('Unsafe or invalid input accepted');
}
$html = '<html><head><link rel="Icon" href="//png.pookcdn.net/icon.ico"><link rel="stylesheet" href="https://css.pookcdn.net/index.2.css"></head><body><div class="video-bg"><video poster="//png.pookcdn.net/poster.jpg"><source src="//png.pookcdn.net/movie.mp4" type="video/mp4"></video></div><a class="logo"><img src="//png.pookcdn.net/logo.png"></a></body></html>';
$parsed = boke_parse($html);
check($parsed['assets']['video'] === 'https://png.pookcdn.net/movie.mp4', 'Video URL');
check($parsed['styles'] === ['https://css.pookcdn.net/index.2.css'], 'Stylesheet discovery');
foreach (['http://png.pookcdn.net/a', 'https://png.pookcdn.net.evil.test/a', 'https://user@png.pookcdn.net/a', 'https://127.0.0.1/a', 'https://png.pookcdn.net:444/a', "https://png.pookcdn.net/\na", 'data:image/png;base64,AAA'] as $url) {
    rejected(fn() => boke_url($url, 'asset'));
}
rejected(fn() => boke_parse('<video src="https://evil.test/clip.mp4"></video>'));
check(boke_accent('#gameMore { background: #dc1e14; color: #fff; }') === '#dc1e14', 'Recognized accent');
check(boke_accent('/* #gameMore { background: #123456; } */ body { color: #123456; }') === null, 'Unknown color keeps fallback');
$etag = 'first';
$requests = 0;
$fetch = static function ($url, $head) use ($html, &$etag, &$requests) {
    $requests++;
    if (!$head) return ['body' => str_ends_with($url, '.css') ? '#gameMore { background: #dc1e14; }' : $html];
    return ['headers' => ['content-type' => str_ends_with($url, '.mp4') ? 'video/mp4' : 'image/png', 'etag' => $etag, 'content-length' => '123']];
};
$first = boke_refresh(null, $fetch);
check($first['accent'] === '#dc1e14', 'Refresh color');
$etag = 'second';
$second = boke_refresh($first, $fetch);
check($first['assets']['video']['revision'] !== $second['assets']['video']['revision'], 'Same URL content replacement');
$directory = sys_get_temp_dir() . '/boke-theme-test-' . bin2hex(random_bytes(6));
try {
    $cache = boke_cached($directory, 300, fn($previous) => $first);
    check($cache['status'] === 'synced', 'Initial cache');
    $cached = boke_cached($directory, 300, function () { throw new RuntimeException('Must not refresh'); });
    check($cached === $cache, 'TTL avoids duplicate requests');
    $stale = boke_cached($directory, 0, function () { throw new RuntimeException('Simulated outage'); });
    check($stale['status'] === 'cached' && $stale['theme'] === $first, 'Outage retains last good theme');
    $lock = fopen($directory . '/sync.lock', 'c');
    flock($lock, LOCK_EX);
    check(boke_cached($directory, 0, function () { throw new RuntimeException('Must not refresh while locked'); }) === $stale, 'Concurrent request uses cache');
    fclose($lock);
    unlink($directory . '/manifest.json');
    check(boke_cached($directory, 0, function () { throw new RuntimeException('Offline first visit'); })['status'] === 'fallback', 'Offline startup');
} finally {
    foreach (glob($directory . '/*') as $file) unlink($file);
    rmdir($directory);
}
echo "Theme parser, URL boundaries, asset replacement, TTL, concurrency and outage checks passed\n";
