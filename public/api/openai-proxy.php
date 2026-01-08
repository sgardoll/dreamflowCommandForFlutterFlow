<?php

declare(strict_types=1);

require_once __DIR__ . '/proxy-utils.php';

$path = $_GET['path'] ?? '';
$path = ltrim($path, '/');

if ($path === '') {
  ccc_json_error(400, 'Missing OpenAI path');
}

$incomingHeaders = ccc_get_request_headers();

$authHeader = '';
foreach ($incomingHeaders as $name => $value) {
  if (strtolower($name) === 'authorization') {
    $authHeader = $value;
    break;
  }
}

if ($authHeader === '') {
  $apiKey = getenv('OPENAI_API_KEY') ?: '';
  if ($apiKey !== '') {
    $authHeader = 'Bearer ' . $apiKey;
  }
}

if ($authHeader === '') {
  ccc_json_error(401, 'OpenAI API key is not configured');
}

$overrides = [
  'Authorization' => $authHeader,
];

$targetUrl = 'https://api.openai.com/' . $path;
$outgoingHeaders = ccc_filter_incoming_headers($incomingHeaders, $overrides);

ccc_forward_request($targetUrl, $outgoingHeaders);
