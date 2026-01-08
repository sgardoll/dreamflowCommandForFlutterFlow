<?php

declare(strict_types=1);

function ccc_get_request_headers(): array {
  if (function_exists('getallheaders')) {
    $headers = getallheaders();
    return is_array($headers) ? $headers : [];
  }

  $headers = [];
  foreach ($_SERVER as $name => $value) {
    if (str_starts_with($name, 'HTTP_')) {
      $headerName = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))));
      $headers[$headerName] = $value;
    }
  }

  if (isset($_SERVER['CONTENT_TYPE'])) {
    $headers['Content-Type'] = $_SERVER['CONTENT_TYPE'];
  }
  if (isset($_SERVER['CONTENT_LENGTH'])) {
    $headers['Content-Length'] = $_SERVER['CONTENT_LENGTH'];
  }

  return $headers;
}

function ccc_json_error(int $statusCode, string $message): void {
  http_response_code($statusCode);
  header('Content-Type: application/json');
  echo json_encode([
    'error' => $message,
  ]);
  exit;
}

function ccc_build_query_string(array $params): string {
  $filtered = [];
  foreach ($params as $key => $value) {
    if ($value === null) continue;
    if ($value === '') continue;
    $filtered[$key] = $value;
  }

  return http_build_query($filtered);
}

function ccc_forward_request(string $targetUrl, array $outgoingHeaders): void {
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  $rawBody = file_get_contents('php://input');

  $ch = curl_init();
  curl_setopt($ch, CURLOPT_URL, $targetUrl);
  curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HEADER, true);
  curl_setopt($ch, CURLOPT_TIMEOUT, 90);
  curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 20);
  curl_setopt($ch, CURLOPT_HTTPHEADER, $outgoingHeaders);

  if (!in_array($method, ['GET', 'HEAD'], true)) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $rawBody);
  }

  $response = curl_exec($ch);

  if ($response === false) {
    $err = curl_error($ch);
    curl_close($ch);
    ccc_json_error(502, 'Upstream request failed: ' . $err);
  }

  $statusCode = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
  curl_close($ch);

  $headerRaw = substr($response, 0, $headerSize);
  $body = substr($response, $headerSize);

  http_response_code($statusCode);

  $forwardHeaderNames = [
    'content-type' => true,
    'cache-control' => true,
    'pragma' => true,
    'x-request-id' => true,
    'request-id' => true,
    'openai-request-id' => true,
    'anthropic-request-id' => true,
  ];

  $lines = preg_split("/\r\n|\n|\r/", trim($headerRaw));
  foreach ($lines as $line) {
    if (str_starts_with($line, 'HTTP/')) continue;
    $parts = explode(':', $line, 2);
    if (count($parts) !== 2) continue;

    $name = trim($parts[0]);
    $value = trim($parts[1]);
    $lower = strtolower($name);

    if (isset($forwardHeaderNames[$lower])) {
      header($name . ': ' . $value);
    }
  }

  if (!headers_sent()) {
    header('X-CCC-Proxy: 1');
  }

  echo $body;
  exit;
}

function ccc_filter_incoming_headers(array $incomingHeaders, array $overrides): array {
  $blocked = [
    'host' => true,
    'content-length' => true,
    'accept-encoding' => true,
    'connection' => true,
    'keep-alive' => true,
    'proxy-authenticate' => true,
    'proxy-authorization' => true,
    'te' => true,
    'trailer' => true,
    'transfer-encoding' => true,
    'upgrade' => true,
  ];

  $out = [];
  foreach ($incomingHeaders as $name => $value) {
    $lower = strtolower($name);
    if (isset($blocked[$lower])) continue;

    $out[] = $name . ': ' . $value;
  }

  foreach ($overrides as $name => $value) {
    $out[] = $name . ': ' . $value;
  }

  return $out;
}
