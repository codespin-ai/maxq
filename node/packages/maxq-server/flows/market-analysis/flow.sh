#!/bin/bash
# Exit immediately with success
# When MAXQ_COMPLETED_STAGE is empty (first call), we can choose to:
# 1. Schedule no stages (run will complete immediately)
# 2. Schedule stages with actual work
# For API tests, we do nothing to avoid scheduler complications
exit 0
