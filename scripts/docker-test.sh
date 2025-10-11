#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
CONTAINER_NAME="maxq-test-$$"
TEST_DB_NAME="maxq_test_$$"
TEST_PORT=${2:-5099}  # Use second argument or default to 5099
TIMEOUT=30

# Function to print colored output
print_info() {
    echo -e "${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}! $1${NC}"
}

# Function to cleanup on exit
cleanup() {
    print_info "Cleaning up..."
    
    # Stop and remove test container
    if docker ps -a | grep -q $CONTAINER_NAME; then
        docker rm -f $CONTAINER_NAME >/dev/null 2>&1
        print_success "Removed test container"
    fi
    
    # Drop test database if it exists
    if [ -n "$POSTGRES_RUNNING" ]; then
        docker exec devenv-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS $TEST_DB_NAME;" >/dev/null 2>&1
        print_success "Dropped test database"
    fi
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Function to wait for service
wait_for_service() {
    local host=$1
    local port=$2
    local service=$3
    local max_attempts=15
    local attempt=1
    
    print_info "Waiting for $service to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        # Try nc first, fall back to curl if not available
        if command -v nc >/dev/null 2>&1; then
            if nc -z $host $port >/dev/null 2>&1; then
                print_success "$service is ready"
                return 0
            fi
        else
            if curl -s http://$host:$port/health >/dev/null 2>&1; then
                print_success "$service is ready"
                return 0
            fi
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    print_error "$service failed to start after $max_attempts attempts"
    return 1
}

# Function to run REST API request
run_api_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local expected_pattern=$4
    local description=$5
    
    print_info "Testing: $description"
    
    local response
    if [ -z "$data" ]; then
        response=$(curl -s -X $method http://localhost:$TEST_PORT$endpoint \
            -H "Content-Type: application/json" 2>/dev/null)
    else
        response=$(curl -s -X $method http://localhost:$TEST_PORT$endpoint \
            -H "Content-Type: application/json" \
            -d "$data" 2>/dev/null)
    fi
    
    if [ -z "$response" ]; then
        print_error "No response received"
        return 1
    fi
    
    # For debugging - show the response in case of failure
    if echo "$response" | grep -q "$expected_pattern"; then
        print_success "$description"
        return 0
    else
        print_error "Unexpected response: $response"
        return 1
    fi
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
    echo "  $0 ghcr.io/codespin-ai/maxq:latest # Test specific image"
    echo "  $0 maxq:latest 5002                # Test on specific port"
    exit 0
fi

# Parse command line arguments
IMAGE_TO_TEST=${1:-"maxq:latest"}
TEST_PORT=${2:-5099}

# Main test script
print_info "=== MaxQ Docker Image Test ==="
echo

# Check if PostgreSQL is running
print_info "Checking for PostgreSQL..."
if docker ps | grep -q "devenv-postgres-1"; then
    POSTGRES_RUNNING=1
    print_success "PostgreSQL is running"
else
    print_warning "PostgreSQL not found. Starting it..."
    cd devenv && ./run.sh up -d
    cd ..
    sleep 5
    POSTGRES_RUNNING=1
fi

# Create test database
print_info "Creating test database..."
docker exec devenv-postgres-1 psql -U postgres -c "CREATE DATABASE $TEST_DB_NAME;" >/dev/null 2>&1
if [ $? -eq 0 ]; then
    print_success "Created test database: $TEST_DB_NAME"
    # Give PostgreSQL a moment to fully commit the database creation
    sleep 2
    print_info "Waiting for database to be fully available..."
else
    print_warning "Test database might already exist"
fi

print_info "Testing image: $IMAGE_TO_TEST on port $TEST_PORT"
echo

# Start the container
print_info "Starting MaxQ container..."
docker run -d --rm \
    --name $CONTAINER_NAME \
    -p $TEST_PORT:5002 \
    --add-host=host.docker.internal:host-gateway \
    -e FOREMAN_DB_HOST=host.docker.internal \
    -e FOREMAN_DB_PORT=5432 \
    -e FOREMAN_DB_NAME=$TEST_DB_NAME \
    -e FOREMAN_DB_USER=postgres \
    -e FOREMAN_DB_PASSWORD=postgres \
    -e UNRESTRICTED_DB_USER=unrestricted_db_user \
    -e UNRESTRICTED_DB_USER_PASSWORD=changeme_admin_password \
    -e RLS_DB_USER=rls_db_user \
    -e RLS_DB_USER_PASSWORD=changeme_rls_password \
    -e FOREMAN_AUTO_MIGRATE=true \
    -e JWT_SECRET=test-secret-key \
    -e LOG_LEVEL=error \
    $IMAGE_TO_TEST >/dev/null 2>&1

if [ $? -ne 0 ]; then
    print_error "Failed to start container"
    exit 1
fi

print_success "Container started"

# Wait for the service to be ready
if ! wait_for_service localhost $TEST_PORT "MaxQ REST API server"; then
    print_error "Server failed to start. Checking logs..."
    docker logs $CONTAINER_NAME
    exit 1
fi

# Give the server a moment to fully initialize
print_info "Waiting for server to fully initialize..."
sleep 5

echo
print_info "=== Running REST API Tests ==="
echo

# Test 1: Health check
if run_api_request \
    "GET" \
    "/health" \
    "" \
    "\"status\":\"healthy\"" \
    "Health check"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 2: Get configuration
if run_api_request \
    "GET" \
    "/api/v1/config" \
    "" \
    "\"version\":" \
    "Get configuration"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 3: Create run
RUN_JSON='{
  "inputData": {
    "test": "data"
  },
  "metadata": {
    "source": "docker-test"
  }
}'

RESPONSE=$(curl -s -X POST http://localhost:$TEST_PORT/api/v1/runs \
    -H "Content-Type: application/json" \
    -H "x-org-id: test-org" \
    -d "$RUN_JSON" 2>/dev/null)

if echo "$RESPONSE" | grep -q "\"id\":"; then
    RUN_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    print_success "Create run"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    print_error "Create run failed: $RESPONSE"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    RUN_ID=""
fi

# Test 4: Get run (if we created one)
if [ -n "$RUN_ID" ]; then
    if run_api_request \
        "GET" \
        "/api/v1/runs/$RUN_ID" \
        "" \
        "\"id\":\"$RUN_ID\"" \
        "Get run"; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
fi

# Test 5: List runs
if run_api_request \
    "GET" \
    "/api/v1/runs" \
    "" \
    "\"data\":" \
    "List runs"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 6: Create task (if we have a run)
if [ -n "$RUN_ID" ]; then
    TASK_JSON="{
      \"runId\": \"$RUN_ID\",
      \"type\": \"test-task\",
      \"inputData\": {
        \"action\": \"test\"
      }
    }"
    
    TASK_RESPONSE=$(curl -s -X POST http://localhost:$TEST_PORT/api/v1/tasks \
        -H "Content-Type: application/json" \
        -H "x-org-id: test-org" \
        -d "$TASK_JSON" 2>/dev/null)
    
    if echo "$TASK_RESPONSE" | grep -q "\"id\":"; then
        TASK_ID=$(echo "$TASK_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
        print_success "Create task"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        print_error "Create task failed: $TASK_RESPONSE"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        TASK_ID=""
    fi
fi

# Test 7: Get task (if we created one)
if [ -n "$TASK_ID" ]; then
    if run_api_request \
        "GET" \
        "/api/v1/tasks/$TASK_ID" \
        "" \
        "\"id\":\"$TASK_ID\"" \
        "Get task"; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
fi

# Test 8: Update run status
if [ -n "$RUN_ID" ]; then
    UPDATE_JSON='{
      "status": "completed",
      "outputData": {
        "result": "success"
      }
    }'
    
    if run_api_request \
        "PATCH" \
        "/api/v1/runs/$RUN_ID" \
        "$UPDATE_JSON" \
        "\"status\":\"completed\"" \
        "Update run"; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
fi

echo
print_info "=== Test Summary ==="
print_success "Tests passed: ${TESTS_PASSED:-0}"
if [ "${TESTS_FAILED:-0}" -gt 0 ]; then
    print_error "Tests failed: $TESTS_FAILED"
else
    print_success "All tests passed!"
fi

echo
print_info "=== Container Health Check ==="
docker logs --tail 10 $CONTAINER_NAME 2>&1 | grep -E "(error|Error|ERROR)" >/dev/null
if [ $? -eq 0 ]; then
    print_warning "Errors found in container logs"
else
    print_success "No errors in container logs"
fi

# Show container info
echo
print_info "=== Container Information ==="
docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo
if [ "${TESTS_FAILED:-0}" -eq 0 ]; then
    print_success "Docker image test completed successfully!"
    exit 0
else
    print_error "Docker image test failed!"
    exit 1
fi