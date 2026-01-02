#!/bin/bash

# Docker test script for MaxQ (SQLite version)
# Tests the Docker image by starting a container and running API tests

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
CONTAINER_NAME="maxq-test-$$"
TEST_PORT=${2:-5099}
TESTS_PASSED=0
TESTS_FAILED=0

# Function to print colored output
print_info() { echo -e "${BLUE}$1${NC}"; }
print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_warning() { echo -e "${YELLOW}! $1${NC}"; }

# Function to cleanup on exit
cleanup() {
    print_info "Cleaning up..."
    if docker ps -a | grep -q $CONTAINER_NAME; then
        docker rm -f $CONTAINER_NAME >/dev/null 2>&1
        print_success "Removed test container"
    fi
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Function to wait for health endpoint
wait_for_health() {
    local max_attempts=15
    local attempt=1

    print_info "Waiting for MaxQ to be ready..."

    while [ $attempt -le $max_attempts ]; do
        if curl -s http://localhost:$TEST_PORT/health | grep -q "healthy"; then
            print_success "MaxQ is ready"
            return 0
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done

    print_error "MaxQ failed to start after $max_attempts attempts"
    return 1
}

# Show usage if help is requested
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "Usage: $0 [IMAGE] [PORT]"
    echo ""
    echo "Arguments:"
    echo "  IMAGE  Docker image to test (default: maxq:latest)"
    echo "  PORT   Port to expose the service on (default: 5099)"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Test maxq:latest on port 5099"
    echo "  $0 ghcr.io/codespin-ai/maxq:latest   # Test specific image"
    echo "  $0 maxq:latest 5100                  # Test on specific port"
    exit 0
fi

# Parse command line arguments
IMAGE_TO_TEST=${1:-"maxq:latest"}

print_info "=== MaxQ Docker Image Test ==="
echo
print_info "Testing image: $IMAGE_TO_TEST on port $TEST_PORT"
echo

# Start the container
print_info "Starting MaxQ container..."
docker run -d --rm \
    --name $CONTAINER_NAME \
    -p $TEST_PORT:5003 \
    -e LOG_LEVEL=info \
    $IMAGE_TO_TEST >/dev/null 2>&1

if [ $? -ne 0 ]; then
    print_error "Failed to start container"
    exit 1
fi

print_success "Container started"

# Wait for the service to be ready
if ! wait_for_health; then
    print_error "Server failed to start. Checking logs..."
    docker logs $CONTAINER_NAME
    exit 1
fi

# Give server a moment to fully initialize
sleep 2

echo
print_info "=== Running API Tests ==="
echo

# Test 1: Health check
print_info "Testing: Health check"
RESPONSE=$(curl -s http://localhost:$TEST_PORT/health)
if echo "$RESPONSE" | grep -q "healthy"; then
    print_success "Health check passed"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    print_error "Health check failed: $RESPONSE"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 2: List runs (should return empty array)
print_info "Testing: List runs"
RESPONSE=$(curl -s http://localhost:$TEST_PORT/api/v1/runs)
if echo "$RESPONSE" | grep -q '"data"'; then
    print_success "List runs passed"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    print_error "List runs failed: $RESPONSE"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 3: Create run (run is created, execution fails async without a flow)
print_info "Testing: Create run"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:$TEST_PORT/api/v1/runs \
    -H "Content-Type: application/json" \
    -d '{"flowName": "test-flow"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "201" ] && echo "$BODY" | grep -q '"id"'; then
    RUN_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    print_success "Create run passed (id: $RUN_ID)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    print_error "Create run unexpected response: $HTTP_CODE - $BODY"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 4: Get non-existent run (should return 404)
print_info "Testing: Get non-existent run (expects 404)"
RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:$TEST_PORT/api/v1/runs/non-existent-id)
HTTP_CODE=$(echo "$RESPONSE" | tail -1)

if [ "$HTTP_CODE" = "404" ]; then
    print_success "Get non-existent run returned 404"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    print_error "Get non-existent run unexpected response: $HTTP_CODE"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

echo
print_info "=== Test Summary ==="
print_success "Tests passed: $TESTS_PASSED"
if [ "$TESTS_FAILED" -gt 0 ]; then
    print_error "Tests failed: $TESTS_FAILED"
else
    print_success "All tests passed!"
fi

echo
print_info "=== Container Logs (last 10 lines) ==="
docker logs --tail 10 $CONTAINER_NAME 2>&1

echo
if [ "$TESTS_FAILED" -eq 0 ]; then
    print_success "Docker image test completed successfully!"
    exit 0
else
    print_error "Docker image test failed!"
    exit 1
fi
