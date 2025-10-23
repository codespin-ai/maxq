#!/bin/bash

# Test signal helpers for bash scripts
# These functions allow bash scripts to coordinate with TypeScript tests via HTTP signals

# Emit a signal that tests can wait for
# Usage: emit_signal "step-started" [optional-payload]
emit_signal() {
  local signal_name="$1"
  local payload="$2"

  if [ -z "$MAXQ_SIGNAL_URL" ]; then
    echo "ERROR: MAXQ_SIGNAL_URL not set" >&2
    exit 1
  fi

  if [ -z "$MAXQ_TEST_ID" ]; then
    echo "ERROR: MAXQ_TEST_ID not set" >&2
    exit 1
  fi

  if [ -z "$signal_name" ]; then
    echo "ERROR: signal_name required" >&2
    exit 1
  fi

  # Build request body
  local body='{}'
  if [ -n "$payload" ]; then
    body="{\"payload\":\"$payload\"}"
  fi

  # Emit the signal via HTTP POST
  local response
  response=$(curl --fail --silent --show-error -w "\n%{http_code}" \
    -X POST "$MAXQ_SIGNAL_URL/signal/$MAXQ_TEST_ID/$signal_name" \
    -H "Content-Type: application/json" \
    -d "$body" 2>&1)
  local curl_exit=$?
  local http_code=$(echo "$response" | tail -n1)

  if [ $curl_exit -ne 0 ] || [ "$http_code" != "200" ]; then
    echo "ERROR: Failed to emit signal '$signal_name'" >&2
    echo "$response" >&2
    exit 1
  fi

  return 0
}

# Wait for a signal from tests (long-polling, blocks until signal arrives or timeout)
# Usage: wait_for_signal "proceed" [timeout_ms]
wait_for_signal() {
  local signal_name="$1"
  local timeout_ms="${2:-30000}"

  if [ -z "$MAXQ_SIGNAL_URL" ]; then
    echo "ERROR: MAXQ_SIGNAL_URL not set" >&2
    exit 1
  fi

  if [ -z "$MAXQ_TEST_ID" ]; then
    echo "ERROR: MAXQ_TEST_ID not set" >&2
    exit 1
  fi

  if [ -z "$signal_name" ]; then
    echo "ERROR: signal_name required" >&2
    exit 1
  fi

  # Wait for signal via HTTP POST with JSON body (long-polling)
  local response
  response=$(curl --fail --silent --show-error --no-buffer -w "\n%{http_code}" \
    -X POST "$MAXQ_SIGNAL_URL/signal/$MAXQ_TEST_ID/$signal_name/wait" \
    -H "Content-Type: application/json" \
    -d "{\"timeout\":$timeout_ms,\"baselineSeq\":0}" 2>&1)
  local curl_exit=$?
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | head -n-1)

  if [ $curl_exit -ne 0 ]; then
    echo "ERROR: Network error waiting for signal '$signal_name'" >&2
    echo "$response" >&2
    exit 1
  fi

  if [ "$http_code" = "200" ]; then
    # Check if signaled=true in JSON response
    if echo "$body" | grep -q '"signaled":true'; then
      return 0
    else
      echo "ERROR: Signal '$signal_name' returned 200 but signaled=false" >&2
      exit 1
    fi
  elif [ "$http_code" = "408" ]; then
    # Timeout - this is a fatal error for test coordination
    echo "ERROR: Timeout waiting for signal '$signal_name' after ${timeout_ms}ms" >&2
    exit 1
  else
    echo "ERROR: Failed to wait for signal '$signal_name' (HTTP $http_code)" >&2
    echo "$body" >&2
    exit 1
  fi
}
