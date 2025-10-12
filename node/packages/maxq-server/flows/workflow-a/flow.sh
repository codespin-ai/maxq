#!/bin/bash
# Schedule a dummy stage via HTTP API
curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps"   -H "Content-Type: application/json"   -d '{
    "stage": "dummy",
    "final": true,
    "steps": []
  }'
