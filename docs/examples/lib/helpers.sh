#!/bin/bash
# MaxQ Helper Library for Flows and Steps
# Source this file in your flow.sh or step.sh scripts

# Ensure required environment variables are set
: "${MAXQ_API:?MAXQ_API environment variable is required}"
: "${MAXQ_RUN_ID:?MAXQ_RUN_ID environment variable is required}"

# Schedule a stage (used by flows)
# Usage: schedule_stage "stage-name" "true|false" '[{step1}, {step2}]'
schedule_stage() {
  local stage_name="$1"
  local is_final="$2"
  local steps_json="$3"

  local response
  response=$(curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \
    -H "Content-Type: application/json" \
    -d "{
      \"stage\": \"$stage_name\",
      \"final\": $is_final,
      \"steps\": $steps_json
    }")

  echo "$response"
}

# Store an artifact (used by steps)
# Usage: store_artifact "artifact-name" '{"key": "value"}' '["tag1", "tag2"]' '{"meta": "data"}'
store_artifact() {
  local artifact_name="$1"
  local artifact_value="$2"
  local tags="${3:-[]}"
  local metadata="${4:-{}}"

  : "${MAXQ_STEP_ID:?MAXQ_STEP_ID required for store_artifact}"
  : "${MAXQ_STEP_NAME:?MAXQ_STEP_NAME required for store_artifact}"
  : "${MAXQ_STEP_SEQUENCE:?MAXQ_STEP_SEQUENCE required for store_artifact}"

  local response
  response=$(curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts" \
    -H "Content-Type: application/json" \
    -d "{
      \"stepId\": \"$MAXQ_STEP_ID\",
      \"stepName\": \"$MAXQ_STEP_NAME\",
      \"sequence\": $MAXQ_STEP_SEQUENCE,
      \"name\": \"$artifact_name\",
      \"value\": $artifact_value,
      \"tags\": $tags,
      \"metadata\": $metadata
    }")

  echo "$response"
}

# Get artifact(s) by step name and artifact name
# Usage: get_artifact "step_name" "artifact_name" [sequence]
get_artifact() {
  local step_name="$1"
  local artifact_name="$2"
  local sequence="${3:-}"

  local query="stepName=$step_name&name=$artifact_name"
  if [ -n "$sequence" ]; then
    query="$query&sequence=$sequence"
  fi

  local response
  response=$(curl -s "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts?$query")

  echo "$response"
}

# Get artifact value (extracts just the value field from first match)
# Usage: get_artifact_value "step_name" "artifact_name" [sequence]
get_artifact_value() {
  local response
  response=$(get_artifact "$@")

  echo "$response" | jq -r '.artifacts[0].value'
}

# Get all artifacts from a step (across all sequences)
# Usage: get_step_artifacts "step_name"
get_step_artifacts() {
  local step_name="$1"

  local response
  response=$(curl -s "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts?stepName=$step_name")

  echo "$response"
}

# Get artifacts by tags
# Usage: get_artifacts_by_tags "tag1,tag2"
get_artifacts_by_tags() {
  local tags="$1"

  local response
  response=$(curl -s "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts?tags=$tags")

  echo "$response"
}

# Update step status (optional - MaxQ does this automatically)
# Usage: update_step_status "completed" '{"result": "success"}' 'null'
update_step_status() {
  local status="$1"
  local output="${2:-null}"
  local error="${3:-null}"

  : "${MAXQ_STEP_ID:?MAXQ_STEP_ID required for update_step_status}"

  local response
  response=$(curl -s -X PATCH "$MAXQ_API/steps/$MAXQ_STEP_ID" \
    -H "Content-Type: application/json" \
    -d "{
      \"status\": \"$status\",
      \"output\": $output,
      \"error\": $error
    }")

  echo "$response"
}

# Get current run details
# Usage: get_run
get_run() {
  local response
  response=$(curl -s "$MAXQ_API/runs/$MAXQ_RUN_ID")

  echo "$response"
}

# Get steps in current run
# Usage: get_steps [stage] [status] [name]
get_steps() {
  local stage="${1:-}"
  local status="${2:-}"
  local name="${3:-}"

  local query=""
  [ -n "$stage" ] && query="$query&stage=$stage"
  [ -n "$status" ] && query="$query&status=$status"
  [ -n "$name" ] && query="$query&name=$name"
  query="${query#&}" # Remove leading &

  local response
  response=$(curl -s "$MAXQ_API/runs/$MAXQ_RUN_ID/steps?$query")

  echo "$response"
}

# Check if a stage has completed
# Usage: stage_completed "stage-name"
stage_completed() {
  local stage_name="$1"

  [ "$MAXQ_COMPLETED_STAGE" = "$stage_name" ]
}

# Check if a stage has failed
# Usage: stage_failed "stage-name"
stage_failed() {
  local stage_name="$1"

  [ "$MAXQ_FAILED_STAGE" = "$stage_name" ]
}

# Log helper functions
log_info() {
  echo "[INFO] $*" >&2
}

log_error() {
  echo "[ERROR] $*" >&2
}

log_debug() {
  echo "[DEBUG] $*" >&2
}

# Validate required commands
validate_command() {
  local cmd="$1"
  if ! command -v "$cmd" &> /dev/null; then
    log_error "Required command not found: $cmd"
    exit 1
  fi
}

# Common validations
validate_required_commands() {
  validate_command curl
  validate_command jq
}

# Export functions for use in scripts
export -f schedule_stage
export -f store_artifact
export -f get_artifact
export -f get_artifact_value
export -f get_step_artifacts
export -f get_artifacts_by_tags
export -f update_step_status
export -f get_run
export -f get_steps
export -f stage_completed
export -f stage_failed
export -f log_info
export -f log_error
export -f log_debug
export -f validate_command
export -f validate_required_commands
