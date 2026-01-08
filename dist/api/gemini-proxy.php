<?php

declare(strict_types=1);

require_once __DIR__ . '/proxy-utils.php';

$path = $_GET['path'] ?? '';
$path = ltrim($path, '/');

if ($path === '') {
  ccc_json_error(400, 'Missing Gemini path');
}

$incomingHeaders = ccc_get_request_headers();

$apiKey = '';
if (isset($_GET['key']) && is_string($_GET['key'])) {
  $apiKey = $_GET['key'];
} else {
  foreach ($incomingHeaders as $name => $value) {
    if (strtolower($name) === 'x-goog-api-key') {
      $apiKey = $value;
      break;
    }
  }
}

if ($apiKey === '') {
  $apiKey = getenv('GEMINI_API_KEY') ?: '';
}

if ($apiKey === '') {
  ccc_json_error(401, 'Gemini API key is not configured');
}

$query = $_GET;
unset($query['path']);
unset($query['key']);
$query['key'] = $apiKey;

$queryString = ccc_build_query_string($query);
$targetUrl = 'https://generativelanguage.googleapis.com/' . $path . ($queryString ? ('?' . $queryString) : '');

$outgoingHeaders = ccc_filter_incoming_headers($incomingHeaders, []);

ccc_forward_request($targetUrl, $outgoingHeaders);
