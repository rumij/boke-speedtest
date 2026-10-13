<?php
// Extract data only. Never execute or relay the official site's HTML, CSS or JS.
declare(strict_types=1);

function boke_url(string $url, string $kind): string
{
    $url = trim($url);
    if (str_starts_with($url, '//')) $url = 'https:' . $url;
    if (str_starts_with($url, '/')) $url = 'https://www.boke.com' . $url;
    $parts = parse_url($url);
    $hosts = $kind === 'css' ? ['css.pookcdn.net', 'www.boke.com'] : ['png.pookcdn.net', 'www.boke.com'];
    if (!$parts || ($parts['scheme'] ?? '') !== 'https' || !in_array($parts['host'] ?? '', $hosts, true)
        || isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])
        || preg_match('/[\x00-\x20\\\\]/', $url) || strlen($url) > 2048) {
        throw new RuntimeException('Unsupported official asset URL');
    }
    return $url;
}

function boke_parse(string $html): array
{
    $doc = new DOMDocument();
    $previous = libxml_use_internal_errors(true);
    try {
        if (!$doc->loadHTML($html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING)) throw new RuntimeException('Invalid homepage');
    } finally {
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
    }
    $xpath = new DOMXPath($doc);
    $video = $xpath->query('//*[contains(concat(" ", normalize-space(@class), " "), " video-bg ")]//video')->item(0);
    $logo = $xpath->query('//a[contains(concat(" ", normalize-space(@class), " "), " logo ")]/img')->item(0);
    $icon = $xpath->query('//link[contains(translate(@rel, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "icon")]')->item(0);
    if (!$video || !$logo || !$icon) throw new RuntimeException('Homepage structure not recognized');
    $source = $xpath->query('.//source[@type="video/mp4"]', $video)->item(0);
    $assets = [
        'video' => boke_url($source ? $source->getAttribute('src') : $video->getAttribute('src'), 'asset'),
        'poster' => boke_url($video->getAttribute('poster'), 'asset'),
        'logo' => boke_url($logo->getAttribute('src'), 'asset'),
        'icon' => boke_url($icon->getAttribute('href'), 'asset'),
    ];
    $styles = [];
    foreach ($xpath->query('//link[@rel="stylesheet"]') as $link) {
        $href = $link->getAttribute('href');
        // Only the homepage's own style sheets can contribute brand colors.
        if (preg_match('~/(?:index|common)[^/]*\.css(?:\?.*)?$~i', $href)) $styles[] = boke_url($href, 'css');
    }
    if (count($styles) > 3) throw new RuntimeException('Too many homepage style sheets');
    return ['assets' => $assets, 'styles' => array_values(array_unique($styles))];
}

function boke_accent(string $css): ?string
{
    $css = preg_replace('~/\*.*?\*/~s', '', $css);
    // Deliberately narrow: an unknown redesign keeps the existing theme color.
    if (preg_match('/#gameMore\s*\{[^}]*?\bbackground(?:-color)?\s*:\s*(#[a-f0-9]{6})\s*[;}]/i', $css, $match)) return strtolower($match[1]);
    return null;
}

function boke_fetch(string $url, bool $head, float $deadline): array
{
    $remaining = (int)(($deadline - microtime(true)) * 1000);
    if ($remaining <= 0) throw new RuntimeException('Sync deadline exceeded');
    $body = '';
    $headers = [];
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_FOLLOWLOCATION => false, // No redirects to arbitrary hosts or internal services.
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT_MS => min(2000, $remaining),
        CURLOPT_TIMEOUT_MS => min(3000, $remaining),
        CURLOPT_NOBODY => $head,
        CURLOPT_USERAGENT => 'Boke-Speedtest-Theme/1.1',
        CURLOPT_HTTPHEADER => ['Cache-Control: no-cache'],
        CURLOPT_HEADERFUNCTION => static function ($handle, $line) use (&$headers) {
            if (str_contains($line, ':')) {
                [$key, $value] = explode(':', $line, 2);
                $headers[strtolower(trim($key))] = trim($value);
            }
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => static function ($handle, $chunk) use (&$body) {
            if (strlen($body) + strlen($chunk) > 1048576) return 0;
            $body .= $chunk;
            return strlen($chunk);
        },
    ]);
    $ok = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    if (!$ok || $status !== 200) throw new RuntimeException('Official resource unavailable');
    return ['body' => $body, 'headers' => $headers];
}

function boke_refresh(?array $previous, callable $fetch): array
{
    $parsed = boke_parse($fetch('https://www.boke.com/', false)['body']);
    $accent = $previous['accent'] ?? '#df241e';
    foreach ($parsed['styles'] as $url) {
        $color = boke_accent($fetch($url, false)['body']);
        if ($color !== null) $accent = $color;
    }
    $assets = [];
    foreach ($parsed['assets'] as $kind => $url) {
        $headers = $fetch($url, true)['headers'];
        $type = strtolower(explode(';', $headers['content-type'] ?? '')[0]);
        $allowed = $kind === 'video' ? ['video/mp4'] : ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon'];
        if (!in_array($type, $allowed, true)) throw new RuntimeException('Unsupported media type');
        // Detect replacement at the SAME URL without downloading a whole movie.
        $revision = hash('sha256', $url . '|' . ($headers['etag'] ?? '') . '|' . ($headers['last-modified'] ?? '') . '|' . ($headers['content-length'] ?? ''));
        $assets[$kind] = ['url' => $url, 'revision' => substr($revision, 0, 20)];
    }
    return ['assets' => $assets, 'accent' => $accent, 'updatedAt' => gmdate('c')];
}

function boke_cached(string $directory, int $interval, callable $refresh): array
{
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Theme cache unavailable');
    $path = $directory . '/manifest.json';
    $read = static function () use ($path) {
        return is_file($path) ? (json_decode((string)@file_get_contents($path), true) ?: []) : [];
    };
    $cache = $read();
    if (time() - ($cache['checked'] ?? 0) < $interval) return $cache;
    $lock = @fopen($directory . '/sync.lock', 'c');
    if (!$lock) throw new RuntimeException('Theme lock unavailable');
    try {
        if (!flock($lock, LOCK_EX | LOCK_NB)) return $cache;
        $cache = $read();
        if (time() - ($cache['checked'] ?? 0) < $interval) return $cache;
        try {
            $cache['theme'] = $refresh($cache['theme'] ?? null);
            $cache['status'] = 'synced';
        } catch (Throwable $error) {
            $cache['status'] = isset($cache['theme']) ? 'cached' : 'fallback';
        }
        $cache['checked'] = time(); // Failed syncs are throttled too.
        $temporary = tempnam($directory, 'theme-');
        if ($temporary === false) throw new RuntimeException('Theme cache unavailable');
        try {
            if (file_put_contents($temporary, json_encode($cache, JSON_THROW_ON_ERROR)) === false || !rename($temporary, $path)) throw new RuntimeException('Theme cache write failed');
        } finally {
            if (is_file($temporary)) unlink($temporary);
        }
        return $cache;
    } finally {
        fclose($lock);
    }
}
