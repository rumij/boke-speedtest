<?php
// Test server only. Never shipped in the image or enabled by the application.
if (PHP_SAPI !== 'cli-server' || getenv('BOKE_IPAPI_KEY') !== 'offline-fixture-key') exit(1);
final class BokeRiskOfflineStream {
    public $context;
    private string $payload = '';
    private int $position = 0;
    public function stream_open($path, $mode, $options, &$openedPath): bool {
        if ($path !== 'https://api.ipapi.is/') throw new RuntimeException('Unexpected external destination');
        $settings = stream_context_get_options($this->context)['http'];
        $body = json_decode($settings['content'], true);
        if ($settings['method'] !== 'POST' || $body['key'] !== 'offline-fixture-key' || $settings['follow_location'] !== 0) {
            throw new RuntimeException('Provider request contract changed');
        }
        $mode = trim(file_get_contents(getenv('BOKE_RISK_STATE_DIR') . '/fixture-mode'));
        $status = in_array($mode, ['401', '403', '429', '503'], true) ? $mode : '200';
        $GLOBALS['http_response_header'] = ['HTTP/1.1 ' . $status . ' Test'];
        $data = ['ip' => $body['q'], 'is_vpn' => true, 'is_proxy' => false, 'is_tor' => false,
            'is_abuser' => false, 'is_datacenter' => true, 'location' => ['country' => 'Fixture']];
        if ($mode === 'partial') unset($data['is_vpn']);
        if ($mode === 'mismatch') $data['ip'] = '8.8.4.4';
        $this->payload = json_encode($data);
        if ($mode === 'invalid') $this->payload = '<html>not json</html>';
        if ($mode === 'oversize') $this->payload = str_repeat('x', 40000);
        file_put_contents(getenv('BOKE_RISK_STATE_DIR') . '/calls', "1\n", FILE_APPEND);
        return true;
    }
    public function stream_read($count): string { $part = substr($this->payload, $this->position, $count); $this->position += strlen($part); return $part; }
    public function stream_eof(): bool { return $this->position >= strlen($this->payload); }
    public function stream_stat(): array { return []; }
}
stream_wrapper_unregister('https');
stream_wrapper_register('https', BokeRiskOfflineStream::class);
