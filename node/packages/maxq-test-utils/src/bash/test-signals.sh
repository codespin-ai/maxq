#!/bin/bash

# Test signal helpers for bash scripts
# These functions allow bash scripts to coordinate with TypeScript tests via HTTP signals

# Emit a signal that tests can wait for
# Usage: emit_signal "step-started"
emit_signal() {
  local signal_name="$1"

  if [ -z "$MAXQ_SIGNAL_URL" ]; then
    echo "ERROR: MAXQ_SIGNAL_URL not set" >&2
    return 1
  fi

  if [ -z "$MAXQ_TEST_ID" ]; then
    echo "ERROR: MAXQ_TEST_ID not set" >&2
    return 1
  fi

  if [ -z "$signal_name" ]; then
    echo "ERROR: signal_name required" >&2
    return 1
  fi

  # Emit the signal via HTTP POST
  local response
  response=$(curl -s -w "\n%{http_code}" -X POST "$MAXQ_SIGNAL_URL/signal/$MAXQ_TEST_ID/$signal_name")
  local http_code=$(echo "$response" | tail -n1)

  if [ "$http_code" != "200" ]; then
    echo "ERROR: Failed to emit signal '$signal_name' (HTTP $http_code)" >&2
    return 1
  fi

  return 0
}

# Wait for a signal from tests (long-polling, blocks until signal arrives or timeout)
# Usage: wait_for_signal "proceed" 30000
wait_for_signal() {
  local signal_name="$1"
  local timeout_ms="${2:-30000}"

  if [ -z "$MAXQ_SIGNAL_URL" ]; then
    echo "ERROR: MAXQ_SIGNAL_URL not set" >&2
    return 1
  fi

  if [ -z "$MAXQ_TEST_ID" ]; then
    echo "ERROR: MAXQ_TEST_ID not set" >&2
    return 1
  fi

  if [ -z "$signal_name" ]; then
    echo "ERROR: signal_name required" >&2
    return 1
  fi

  # Wait for signal via HTTP GET (long-polling)
  local response
  response=$(curl -s -w "\n%{http_code}" -X GET "$MAXQ_SIGNAL_URL/signal/$MAXQ_TEST_ID/$signal_name?timeout=$timeout_ms")
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | head -n-1)

  if [ "$http_code" = "200" ]; then
    # Check if signaled=true in JSON response
    if echo "$body" | grep -q '"signaled":true'; then
      return 0
    else
      echo "ERROR: Signal '$signal_name' returned 200 but signaled=false" >&2
      return 1
    fi
  elif [ "$http_code" = "408" ]; then
    # Timeout
    echo "ERROR: Timeout waiting for signal '$signal_name'" >&2
    return 1
  else
    echo "ERROR: Failed to wait for signal '$signal_name' (HTTP $http_code)" >&2
    return 1
  fi
}
