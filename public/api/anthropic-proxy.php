<?php

declare(strict_types=1);

require_once __DIR__ . '/proxy-utils.php';

$path = $_GET['path'] ?? '';
$path = ltrim($path, '/');

if ($path === '') {
  ccc_json_error(400, 'Missing Anthropic path');
}

$incomingHeaders = ccc_get_request_headers();

$apiKey = '';
foreach ($incomingHeaders as $name => $value) {
  if (strtolower($name) === 'x-api-key') {
    $apiKey = $value;
    break;
  }
}

if ($apiKey === '') {
  $apiKey = getenv('ANTHROPIC_API_KEY') ?: '';
}

if ($apiKey === '') {
  ccc_json_error(401, 'Anthropic API key is not configured');
}

$overrides = [
  'x-api-key' => $apiKey,
];

$hasVersion = false;
foreach ($incomingHeaders as $name => $value) {
  if (strtolower($name) === 'anthropic-version') {
    $hasVersion = true;
    break;
  }
}

if (!$hasVersion) {
  $overrides['anthropic-version'] = '2023-06-01';
}

$targetUrl = 'https://api.anthropic.com/' . $path;
$outgoingHeaders = ccc_filter_incoming_headers($incomingHeaders, $overrides);

ccc_forward_request($targetUrl, $outgoingHeaders);
