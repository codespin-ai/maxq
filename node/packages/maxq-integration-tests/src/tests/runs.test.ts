import { expect } from "chai";
import { testDb, client } from "../test-setup.js";
import type { Run, PaginatedResult } from "@codespin/maxq-server";

describe("Runs API", () => {
  beforeEach(async () => {
    await testDb.truncateAllTables();
  });

  describe("POST /api/v1/runs", () => {
    it("should create a new run with minimal data", async () => {
      const response = await client.post<Run>("/api/v1/runs", {
        flowName: "test-workflow",
      });

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("id");
      expect(response.data).to.have.property("flowName", "test-workflow");
      expect(response.data).to.have.property("status", "pending");
      expect(response.data).to.have.property("createdAt");
    });

    it("should create a run with input data", async () => {
      const response = await client.post<Run>("/api/v1/runs", {
        flowName: "market-analysis",
        input: { symbol: "AAPL", interval: "1d" },
      });

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("flowName", "market-analysis");
      expect(response.data).to.have.property("input");
      expect(response.data.input).to.deep.equal({
        symbol: "AAPL",
        interval: "1d",
      });
    });

    it("should create a run with metadata", async () => {
      const response = await client.post<Run>("/api/v1/runs", {
        flowName: "data-pipeline",
        metadata: { source: "api", priority: "high" },
      });

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("metadata");
      expect(response.data.metadata).to.deep.equal({
        source: "api",
        priority: "high",
      });
    });

    it("should return 400 for invalid input", async () => {
      const response = await client.post<{ error: string }>("/api/v1/runs", {
        // Missing required flowName
      });

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property("error");
    });
  });

  describe("GET /api/v1/runs/:id", () => {
    it("should get a run by id", async () => {
      // Create a run first
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
        input: { test: "data" },
      });
      const runId = createResponse.data.id;

      // Get the run
      const response = await client.get<Run>(`/api/v1/runs/${runId}`);

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("id", runId);
      expect(response.data).to.have.property("flowName", "test-flow");
      expect(response.data).to.have.property("input");
      expect(response.data.input).to.deep.equal({ test: "data" });
    });

    it("should return 404 for non-existent run", async () => {
      const response = await client.get<{ error: string }>(
        "/api/v1/runs/non-existent-id",
      );

      expect(response.status).to.equal(404);
      expect(response.data).to.have.property("error");
    });
  });

  describe("PATCH /api/v1/runs/:id", () => {
    it("should update run status", async () => {
      // Create a run first
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Update the run
      const response = await client.patch<Run>(`/api/v1/runs/${runId}`, {
        status: "running",
      });

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("id", runId);
      expect(response.data).to.have.property("status", "running");
    });

    it("should update run output data", async () => {
      // Create a run first
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Update with output data
      const response = await client.patch<Run>(`/api/v1/runs/${runId}`, {
        status: "completed",
        output: { result: "success", count: 42 },
      });

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("status", "completed");
      expect(response.data).to.have.property("output");
      expect(response.data.output).to.deep.equal({
        result: "success",
        count: 42,
      });
    });

    it("should update run with error", async () => {
      // Create a run first
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Update with error
      const response = await client.patch<Run>(`/api/v1/runs/${runId}`, {
        status: "failed",
        error: { message: "Step failed", code: "STEP_ERROR" },
      });

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("status", "failed");
      expect(response.data).to.have.property("error");
      expect(response.data.error).to.deep.equal({
        message: "Step failed",
        code: "STEP_ERROR",
      });
    });

    it("should return 400 for non-existent run", async () => {
      const response = await client.patch<{ error: string }>(
        "/api/v1/runs/non-existent-id",
        {
          status: "completed",
        },
      );

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property("error");
    });

    it("should return 400 for invalid status", async () => {
      // Create a run first
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Try to update with invalid status
      const response = await client.patch<{ error: string }>(
        `/api/v1/runs/${runId}`,
        {
          status: "invalid-status",
        },
      );

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property("error");
    });

    it("should update run with name and description", async () => {
      // Create a run first
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Update with name and description
      const response = await client.patch<Run>(`/api/v1/runs/${runId}`, {
        name: "Q4 Analysis",
        description: "Quarterly market analysis for tech sector",
      });

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("name", "Q4 Analysis");
      expect(response.data).to.have.property(
        "description",
        "Quarterly market analysis for tech sector",
      );
    });
  });

  describe("GET /api/v1/runs", () => {
    it("should list runs with pagination", async () => {
      // Create a few runs
      await client.post<Run>("/api/v1/runs", {
        flowName: "flow-1",
        input: { test: 1 },
      });
      await client.post<Run>("/api/v1/runs", {
        flowName: "flow-2",
        input: { test: 2 },
      });
      await client.post<Run>("/api/v1/runs", {
        flowName: "flow-3",
        input: { test: 3 },
      });

      // List runs with limit
      const response = await client.get<PaginatedResult<Run>>(
        "/api/v1/runs?limit=2",
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("data");
      expect(response.data).to.have.property("pagination");
      expect(response.data.data).to.have.lengthOf(2);
      expect(response.data.pagination).to.have.property("total", 3);
      expect(response.data.pagination).to.have.property("limit", 2);
      expect(response.data.pagination).to.have.property("offset", 0);
    });

    it("should filter runs by flowName", async () => {
      // Create runs with different flow names
      await client.post<Run>("/api/v1/runs", { flowName: "workflow-a" });
      await client.post<Run>("/api/v1/runs", { flowName: "workflow-b" });
      await client.post<Run>("/api/v1/runs", { flowName: "workflow-a" });

      // Filter by flowName
      const response = await client.get<PaginatedResult<Run>>(
        "/api/v1/runs?flowName=workflow-a",
      );

      expect(response.status).to.equal(200);
      expect(response.data.data).to.have.lengthOf(2);
      expect(response.data.data[0]!).to.have.property("flowName", "workflow-a");
      expect(response.data.data[1]!).to.have.property("flowName", "workflow-a");
    });

    it("should filter runs by status", async () => {
      // Create runs with different statuses
      // Note: With scheduler-driven model, runs will be automatically executed
      // So we mark them with different statuses explicitly
      const run1Response = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow-1",
      });
      const run2Response = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow-2",
      });

      // Wait for orchestrator to finish attempting execution
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update one to completed and one to failed
      await client.patch<Run>(`/api/v1/runs/${run1Response.data.id}`, {
        status: "completed",
      });
      await client.patch<Run>(`/api/v1/runs/${run2Response.data.id}`, {
        status: "failed",
      });

      // Filter by status=completed
      const response = await client.get<PaginatedResult<Run>>(
        "/api/v1/runs?status=completed",
      );

      expect(response.status).to.equal(200);
      expect(response.data.data).to.have.lengthOf(1);
      expect(response.data.data[0]!).to.have.property("status", "completed");
      expect(response.data.data[0]!).to.have.property(
        "id",
        run1Response.data.id,
      );
    });

    it("should handle pagination with offset", async () => {
      // Create several runs
      for (let i = 0; i < 5; i++) {
        await client.post<Run>("/api/v1/runs", {
          flowName: "test-flow",
          input: { index: i },
        });
      }

      // Get second page
      const response = await client.get<PaginatedResult<Run>>(
        "/api/v1/runs?limit=2&offset=2",
      );

      expect(response.status).to.equal(200);
      expect(response.data.data).to.have.lengthOf(2);
      expect(response.data.pagination).to.have.property("total", 5);
      expect(response.data.pagination).to.have.property("limit", 2);
      expect(response.data.pagination).to.have.property("offset", 2);
    });

    it("should sort runs by createdAt descending by default", async () => {
      // Create runs with delays to ensure different timestamps
      const run1 = await client.post<Run>("/api/v1/runs", {
        flowName: "flow-1",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const run2 = await client.post<Run>("/api/v1/runs", {
        flowName: "flow-2",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const run3 = await client.post<Run>("/api/v1/runs", {
        flowName: "flow-3",
      });

      const response = await client.get<PaginatedResult<Run>>("/api/v1/runs");

      expect(response.status).to.equal(200);
      expect(response.data.data).to.have.lengthOf(3);
      // Most recent first (descending)
      expect(response.data.data[0]!.id).to.equal(run3.data.id);
      expect(response.data.data[1]!.id).to.equal(run2.data.id);
      expect(response.data.data[2]!.id).to.equal(run1.data.id);
    });
  });

  describe("POST /api/v1/runs/:runId/abort", () => {
    it("should abort a running workflow", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Wait for orchestrator to finish (test flow completes immediately)
      await testDb.waitForQuery(
        (q, p) =>
          q
            .from("run")
            .where(
              (r) =>
                r.id === p.runId &&
                (r.status === "completed" || r.status === "failed"),
            )
            .select((r) => ({ id: r.id })),
        { runId },
        { timeout: 5000 },
      );

      // For this test, we'll update status back to "running" manually to test abort
      // In real scenarios, a run would be running with active processes
      await client.patch<Run>(`/api/v1/runs/${runId}`, {
        status: "running",
      });

      // Abort the run
      const response = await client.post<{ message: string }>(
        `/api/v1/runs/${runId}/abort`,
        {},
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("message");

      // Verify run is aborted (status=failed with termination_reason=aborted)
      const getResponse = await client.get<Run>(`/api/v1/runs/${runId}`);
      expect(getResponse.data).to.have.property("status", "failed");
      expect(getResponse.data).to.have.property("terminationReason", "aborted");
    });

    it("should return 404 for non-existent run", async () => {
      const response = await client.post<{ error: string }>(
        "/api/v1/runs/non-existent-id/abort",
        {},
      );

      expect(response.status).to.equal(404);
      expect(response.data).to.have.property("error");
    });

    it("should return 400 for already completed run", async () => {
      // Create and complete a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      await client.patch<Run>(`/api/v1/runs/${runId}`, {
        status: "completed",
      });

      // Try to abort completed run
      const response = await client.post<{ error: string }>(
        `/api/v1/runs/${runId}/abort`,
        {},
      );

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property("error");
    });
  });

  describe("POST /api/v1/runs/:runId/retry", () => {
    it("should retry an aborted workflow", async () => {
      // Create, run, and abort a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Wait for orchestrator to finish
      await testDb.waitForQuery(
        (q, p) =>
          q
            .from("run")
            .where(
              (r) =>
                r.id === p.runId &&
                (r.status === "completed" || r.status === "failed"),
            )
            .select((r) => ({ id: r.id })),
        { runId },
        { timeout: 5000 },
      );

      await client.patch<Run>(`/api/v1/runs/${runId}`, {
        status: "running",
      });

      await client.post(`/api/v1/runs/${runId}/abort`, {});

      // Retry the run
      const response = await client.post<{ run: Run; message: string }>(
        `/api/v1/runs/${runId}/retry`,
        {},
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("message");
      expect(response.data).to.have.property("run");

      // Verify run is back to pending (using run from response, not GET)
      // This avoids race condition with the orchestrator that starts immediately
      expect(response.data.run).to.have.property("status", "pending");
      expect(response.data.run).to.not.have.property("terminationReason");
    });

    it("should retry a failed workflow", async () => {
      // Create a run and mark it as failed
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Wait for orchestrator to finish
      await testDb.waitForQuery(
        (q, p) =>
          q
            .from("run")
            .where(
              (r) =>
                r.id === p.runId &&
                (r.status === "completed" || r.status === "failed"),
            )
            .select((r) => ({ id: r.id })),
        { runId },
        { timeout: 5000 },
      );

      await client.patch<Run>(`/api/v1/runs/${runId}`, {
        status: "failed",
      });

      // Retry the run
      const response = await client.post<{ run: Run; message: string }>(
        `/api/v1/runs/${runId}/retry`,
        {},
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("message");
      expect(response.data).to.have.property("run");
      expect(response.data.run).to.have.property("status", "pending");
      expect(response.data.run).to.not.have.property("terminationReason");
    });

    it("should return 404 for non-existent run", async () => {
      const response = await client.post<{ error: string }>(
        "/api/v1/runs/non-existent-id/retry",
        {},
      );

      expect(response.status).to.equal(404);
      expect(response.data).to.have.property("error");
    });

    it("should return 409 for run still in progress", async () => {
      // Create a run that's still running (not aborted)
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Wait for orchestrator to finish
      await testDb.waitForQuery(
        (q, p) =>
          q
            .from("run")
            .where(
              (r) =>
                r.id === p.runId &&
                (r.status === "completed" || r.status === "failed"),
            )
            .select((r) => ({ id: r.id })),
        { runId },
        { timeout: 5000 },
      );

      await client.patch<Run>(`/api/v1/runs/${runId}`, {
        status: "running",
      });

      // Try to retry run that's still in progress
      const response = await client.post<{ error: string }>(
        `/api/v1/runs/${runId}/retry`,
        {},
      );

      expect(response.status).to.equal(409);
      expect(response.data).to.have.property("error");
      expect(response.data.error).to.include("still in progress");
    });

    it("should return 400 for completed run", async () => {
      // Create and complete a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      await client.patch<Run>(`/api/v1/runs/${runId}`, {
        status: "completed",
      });

      // Try to retry completed run
      const response = await client.post<{ error: string }>(
        `/api/v1/runs/${runId}/retry`,
        {},
      );

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property("error");
      expect(response.data.error).to.include("cannot be retried");
    });
  });

  describe("POST /api/v1/runs/:runId/logs", () => {
    it("should create a run log entry", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Create a log entry
      const response = await client.post<{
        id: string;
        runId: string;
        entityType: string;
        level: string;
        message: string;
        createdAt: number;
      }>(`/api/v1/runs/${runId}/logs`, {
        entityType: "run",
        level: "info",
        message: "Workflow started",
      });

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("id");
      expect(response.data).to.have.property("runId", runId);
      expect(response.data).to.have.property("entityType", "run");
      expect(response.data).to.have.property("level", "info");
      expect(response.data).to.have.property("message", "Workflow started");
      expect(response.data).to.have.property("createdAt");
    });

    it("should create a log with entity id and metadata", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Create a log entry with entity id and metadata
      const response = await client.post<{
        id: string;
        runId: string;
        entityType: string;
        entityId?: string;
        level: string;
        message: string;
        metadata?: unknown;
        createdAt: number;
      }>(`/api/v1/runs/${runId}/logs`, {
        entityType: "step",
        entityId: "fetch-data",
        level: "error",
        message: "Step failed",
        metadata: { exitCode: 1, signal: "SIGTERM" },
      });

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("entityType", "step");
      expect(response.data).to.have.property("entityId", "fetch-data");
      expect(response.data).to.have.property("level", "error");
      expect(response.data).to.have.property("message", "Step failed");
      expect(response.data).to.have.property("metadata");
      expect(response.data.metadata).to.deep.equal({
        exitCode: 1,
        signal: "SIGTERM",
      });
    });

    it("should return 400 for invalid log level", async () => {
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      const response = await client.post<{ error: string }>(
        `/api/v1/runs/${runId}/logs`,
        {
          entityType: "run",
          level: "invalid-level",
          message: "Test message",
        },
      );

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property("error");
    });

    it("should return 400 for missing required fields", async () => {
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      const response = await client.post<{ error: string }>(
        `/api/v1/runs/${runId}/logs`,
        {
          entityType: "run",
          // Missing level and message
        },
      );

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property("error");
    });
  });

  describe("GET /api/v1/runs/:runId/logs", () => {
    it("should list all logs for a run", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Create multiple log entries
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "run",
        level: "info",
        message: "Workflow started",
      });
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "stage",
        entityId: "stage-1",
        level: "info",
        message: "Stage started",
      });
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "step",
        entityId: "step-1",
        level: "debug",
        message: "Step executing",
      });

      // List all logs
      const response = await client.get<{
        logs: Array<{
          id: string;
          runId: string;
          entityType: string;
          level: string;
          message: string;
        }>;
        count: number;
      }>(`/api/v1/runs/${runId}/logs`);

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("logs");
      expect(response.data).to.have.property("count", 3);
      expect(response.data.logs).to.have.lengthOf(3);
    });

    it("should filter logs by entity type", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Create logs with different entity types
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "run",
        level: "info",
        message: "Run log",
      });
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "step",
        entityId: "step-1",
        level: "info",
        message: "Step log 1",
      });
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "step",
        entityId: "step-2",
        level: "info",
        message: "Step log 2",
      });

      // Filter by entity type
      const response = await client.get<{
        logs: Array<{
          id: string;
          entityType: string;
          message: string;
        }>;
        count: number;
      }>(`/api/v1/runs/${runId}/logs?entityType=step`);

      expect(response.status).to.equal(200);
      expect(response.data.count).to.equal(2);
      expect(response.data.logs).to.have.lengthOf(2);
      expect(response.data.logs[0]!.entityType).to.equal("step");
      expect(response.data.logs[1]!.entityType).to.equal("step");
    });

    it("should filter logs by entity id", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Create logs with different entity ids
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "step",
        entityId: "step-1",
        level: "info",
        message: "Step 1 started",
      });
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "step",
        entityId: "step-1",
        level: "info",
        message: "Step 1 completed",
      });
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "step",
        entityId: "step-2",
        level: "info",
        message: "Step 2 started",
      });

      // Filter by entity id
      const response = await client.get<{
        logs: Array<{
          id: string;
          entityId?: string;
          message: string;
        }>;
        count: number;
      }>(`/api/v1/runs/${runId}/logs?entityId=step-1`);

      expect(response.status).to.equal(200);
      expect(response.data.count).to.equal(2);
      expect(response.data.logs).to.have.lengthOf(2);
      expect(response.data.logs[0]!.entityId).to.equal("step-1");
      expect(response.data.logs[1]!.entityId).to.equal("step-1");
    });

    it("should filter logs by level", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Create logs with different levels
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "run",
        level: "debug",
        message: "Debug message",
      });
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "run",
        level: "error",
        message: "Error message",
      });
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "run",
        level: "info",
        message: "Info message",
      });

      // Filter by level
      const response = await client.get<{
        logs: Array<{
          id: string;
          level: string;
          message: string;
        }>;
        count: number;
      }>(`/api/v1/runs/${runId}/logs?level=error`);

      expect(response.status).to.equal(200);
      expect(response.data.count).to.equal(1);
      expect(response.data.logs).to.have.lengthOf(1);
      expect(response.data.logs[0]!.level).to.equal("error");
      expect(response.data.logs[0]!.message).to.equal("Error message");
    });

    it("should respect limit parameter", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Create multiple logs
      for (let i = 0; i < 5; i++) {
        await client.post(`/api/v1/runs/${runId}/logs`, {
          entityType: "run",
          level: "info",
          message: `Log ${i}`,
        });
      }

      // Request with limit
      const response = await client.get<{
        logs: Array<unknown>;
        count: number;
      }>(`/api/v1/runs/${runId}/logs?limit=3`);

      expect(response.status).to.equal(200);
      expect(response.data.logs).to.have.lengthOf(3);
      expect(response.data.count).to.equal(3);
    });

    it("should sort logs by createdAt descending", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Create logs with delays
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "run",
        level: "info",
        message: "First log",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "run",
        level: "info",
        message: "Second log",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "run",
        level: "info",
        message: "Third log",
      });

      // Get logs
      const response = await client.get<{
        logs: Array<{
          message: string;
          createdAt: number;
        }>;
      }>(`/api/v1/runs/${runId}/logs`);

      expect(response.status).to.equal(200);
      // Most recent first
      expect(response.data.logs[0]!.message).to.equal("Third log");
      expect(response.data.logs[1]!.message).to.equal("Second log");
      expect(response.data.logs[2]!.message).to.equal("First log");

      // Verify descending order
      expect(response.data.logs[0]!.createdAt).to.be.greaterThan(
        response.data.logs[1]!.createdAt,
      );
      expect(response.data.logs[1]!.createdAt).to.be.greaterThan(
        response.data.logs[2]!.createdAt,
      );
    });

    it("should combine multiple filters", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Create logs with various combinations
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "step",
        entityId: "step-1",
        level: "error",
        message: "Step 1 error",
      });
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "step",
        entityId: "step-1",
        level: "info",
        message: "Step 1 info",
      });
      await client.post(`/api/v1/runs/${runId}/logs`, {
        entityType: "step",
        entityId: "step-2",
        level: "error",
        message: "Step 2 error",
      });

      // Filter by both entityType and level
      const response = await client.get<{
        logs: Array<{
          entityType: string;
          entityId?: string;
          level: string;
          message: string;
        }>;
        count: number;
      }>(`/api/v1/runs/${runId}/logs?entityType=step&level=error`);

      expect(response.status).to.equal(200);
      expect(response.data.count).to.equal(2);
      expect(response.data.logs).to.have.lengthOf(2);

      // Both should be steps with error level
      response.data.logs.forEach((log) => {
        expect(log.entityType).to.equal("step");
        expect(log.level).to.equal("error");
      });
    });
  });

  describe("POST /api/v1/runs/:runId/pause", () => {
    it("should pause a pending run", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-workflow",
      });
      const runId = createResponse.data.id;

      // Pause it
      const pauseResponse = await client.post<{
        message: string;
        processesKilled: number;
      }>(`/api/v1/runs/${runId}/pause`);

      expect(pauseResponse.status).to.equal(200);
      expect(pauseResponse.data.message).to.equal("Run paused successfully");

      // Verify run status
      const getResponse = await client.get<Run>(`/api/v1/runs/${runId}`);
      expect(getResponse.data.status).to.equal("paused");
    });

    it("should not pause an already completed run", async () => {
      // Create a run and mark it as completed
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-workflow",
      });
      const runId = createResponse.data.id;

      // Mark as completed
      await client.patch(`/api/v1/runs/${runId}`, {
        status: "completed",
        completedAt: Date.now(),
      });

      // Try to pause
      const pauseResponse = await client.post<{ error: string }>(
        `/api/v1/runs/${runId}/pause`,
        {},
      );

      expect(pauseResponse.status).to.equal(400);
      expect(pauseResponse.data.error).to.include("already completed");
    });

    it("should not pause an already failed run", async () => {
      // Create a run and mark it as failed
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-workflow",
      });
      const runId = createResponse.data.id;

      // Wait for orchestrator to finish
      await testDb.waitForQuery(
        (q, p) =>
          q
            .from("run")
            .where(
              (r) =>
                r.id === p.runId &&
                (r.status === "completed" || r.status === "failed"),
            )
            .select((r) => ({ id: r.id })),
        { runId },
        { timeout: 5000 },
      );

      // Mark as failed
      await client.patch(`/api/v1/runs/${runId}`, {
        status: "failed",
        completedAt: Date.now(),
      });

      // Try to pause
      const pauseResponse = await client.post<{ error: string }>(
        `/api/v1/runs/${runId}/pause`,
        {},
      );

      expect(pauseResponse.status).to.equal(400);
      expect(pauseResponse.data.error).to.include("already failed");
    });

    it("should return 404 for non-existent run", async () => {
      const pauseResponse = await client.post<{ error: string }>(
        "/api/v1/runs/non-existent-id/pause",
        {},
      );

      expect(pauseResponse.status).to.equal(404);
      expect(pauseResponse.data.error).to.include("not found");
    });
  });

  describe("POST /api/v1/runs/:runId/resume", () => {
    it("should resume a paused run", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-workflow",
      });
      const runId = createResponse.data.id;

      // Pause it
      await client.post(`/api/v1/runs/${runId}/pause`);

      // Verify it's paused
      const pausedRun = await client.get<Run>(`/api/v1/runs/${runId}`);
      expect(pausedRun.data.status).to.equal("paused");

      // Resume it
      const resumeResponse = await client.post<{
        run: Run;
        message: string;
      }>(`/api/v1/runs/${runId}/resume`);

      expect(resumeResponse.status).to.equal(200);
      expect(resumeResponse.data.message).to.equal("Run resumed successfully");
      expect(resumeResponse.data.run.status).to.equal("pending");
    });

    it("should not resume a non-paused run", async () => {
      // Create a run (not paused)
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-workflow",
      });
      const runId = createResponse.data.id;

      // Try to resume
      const resumeResponse = await client.post<{ error: string }>(
        `/api/v1/runs/${runId}/resume`,
        {},
      );

      expect(resumeResponse.status).to.equal(400);
      expect(resumeResponse.data.error).to.include("cannot be resumed");
    });

    it("should not resume a completed run", async () => {
      // Create a run and mark it as completed
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-workflow",
      });
      const runId = createResponse.data.id;

      // Mark as completed
      await client.patch(`/api/v1/runs/${runId}`, {
        status: "completed",
        completedAt: Date.now(),
      });

      // Try to resume
      const resumeResponse = await client.post<{ error: string }>(
        `/api/v1/runs/${runId}/resume`,
        {},
      );

      expect(resumeResponse.status).to.equal(400);
      expect(resumeResponse.data.error).to.include("cannot be resumed");
    });

    it("should return 404 for non-existent run", async () => {
      const resumeResponse = await client.post<{ error: string }>(
        "/api/v1/runs/non-existent-id/resume",
        {},
      );

      expect(resumeResponse.status).to.equal(404);
      expect(resumeResponse.data.error).to.include("not found");
    });
  });

  describe("POST /api/v1/runs/:runId/steps/:stepId/retry", () => {
    it("should retry a failed step without cascading", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-workflow",
      });
      const runId = createResponse.data.id;

      // Manually insert a stage and a failed step
      await testDb.insertStage({
        id: "stage-1",
        run_id: runId,
        name: "test-stage",
        final: false,
        status: "failed",
        created_at: Date.now(),
      });

      await testDb.insertStep({
        id: "step-1",
        run_id: runId,
        stage_id: "stage-1",
        name: "test-step",
        status: "failed",
        depends_on: [],
        retry_count: 0,
        max_retries: 3,
        created_at: Date.now(),
      });

      // Mark run as failed
      await client.patch(`/api/v1/runs/${runId}`, {
        status: "failed",
      });

      // Retry the step without cascading
      const retryResponse = await client.post<{
        step: Run;
        cascadedSteps: Run[];
        message: string;
      }>(`/api/v1/runs/${runId}/steps/step-1/retry`, {
        cascadeDownstream: false,
      });

      expect(retryResponse.status).to.equal(200);
      expect(retryResponse.data.message).to.equal("Step retried successfully");
      expect(retryResponse.data.step.status).to.equal("pending");
      expect(retryResponse.data.cascadedSteps).to.have.lengthOf(0);

      // Verify run status changed to running
      const runResponse = await client.get<Run>(`/api/v1/runs/${runId}`);
      expect(runResponse.data.status).to.equal("running");
    });

    it("should retry a failed step with cascading to dependent steps", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-workflow",
      });
      const runId = createResponse.data.id;

      // Insert stage
      await testDb.insertStage({
        id: "stage-1",
        run_id: runId,
        name: "test-stage",
        final: false,
        status: "failed",
        created_at: Date.now(),
      });

      // Insert failed step
      await testDb.insertStep({
        id: "step-1",
        run_id: runId,
        stage_id: "stage-1",
        name: "test-step-1",
        status: "failed",
        depends_on: [],
        retry_count: 0,
        max_retries: 3,
        created_at: Date.now(),
      });

      // Insert dependent step (depends on step-1)
      await testDb.insertStep({
        id: "step-2",
        run_id: runId,
        stage_id: "stage-1",
        name: "test-step-2",
        status: "failed",
        depends_on: ["step-1"],
        retry_count: 0,
        max_retries: 3,
        created_at: Date.now(),
      });

      // Mark run as failed
      await client.patch(`/api/v1/runs/${runId}`, {
        status: "failed",
      });

      // Retry the step with cascading
      const retryResponse = await client.post<{
        step: Run;
        cascadedSteps: Run[];
        message: string;
      }>(`/api/v1/runs/${runId}/steps/step-1/retry`, {
        cascadeDownstream: true,
      });

      expect(retryResponse.status).to.equal(200);
      expect(retryResponse.data.step.status).to.equal("pending");
      expect(retryResponse.data.cascadedSteps).to.have.lengthOf(1);
      expect(retryResponse.data.cascadedSteps[0]?.id).to.equal("step-2");
      expect(retryResponse.data.cascadedSteps[0]?.status).to.equal("pending");
      expect(retryResponse.data.message).to.include("1 dependent steps");
    });

    it("should not retry a non-failed step", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-workflow",
      });
      const runId = createResponse.data.id;

      // Insert stage and completed step
      await testDb.insertStage({
        id: "stage-1",
        run_id: runId,
        name: "test-stage",
        final: false,
        status: "completed",
        created_at: Date.now(),
      });

      await testDb.insertStep({
        id: "step-1",
        run_id: runId,
        stage_id: "stage-1",
        name: "test-step",
        status: "completed",
        depends_on: [],
        retry_count: 0,
        max_retries: 3,
        created_at: Date.now(),
      });

      // Mark run as failed so it's not actively running
      await client.patch(`/api/v1/runs/${runId}`, {
        status: "failed",
      });

      // Try to retry a completed step
      const retryResponse = await client.post<{ error: string }>(
        `/api/v1/runs/${runId}/steps/step-1/retry`,
        {},
      );

      expect(retryResponse.status).to.equal(400);
      expect(retryResponse.data.error).to.include("only failed steps");
    });

    it("should not retry a step from a completed run", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-workflow",
      });
      const runId = createResponse.data.id;

      // Insert stage and step
      await testDb.insertStage({
        id: "stage-1",
        run_id: runId,
        name: "test-stage",
        final: false,
        status: "completed",
        created_at: Date.now(),
      });

      await testDb.insertStep({
        id: "step-1",
        run_id: runId,
        stage_id: "stage-1",
        name: "test-step",
        status: "failed",
        depends_on: [],
        retry_count: 0,
        max_retries: 3,
        created_at: Date.now(),
      });

      // Mark run as completed
      await client.patch(`/api/v1/runs/${runId}`, {
        status: "completed",
        completedAt: Date.now(),
      });

      // Try to retry
      const retryResponse = await client.post<{ error: string }>(
        `/api/v1/runs/${runId}/steps/step-1/retry`,
        {},
      );

      expect(retryResponse.status).to.equal(400);
      expect(retryResponse.data.error).to.include("run is completed");
    });

    it("should return 404 for non-existent step", async () => {
      // Create a run
      const createResponse = await client.post<Run>("/api/v1/runs", {
        flowName: "test-workflow",
      });
      const runId = createResponse.data.id;

      // Wait for orchestrator to finish (test flow completes immediately)
      await testDb.waitForQuery(
        (q, p) =>
          q
            .from("run")
            .where(
              (r) =>
                r.id === p.runId &&
                (r.status === "completed" || r.status === "failed"),
            )
            .select((r) => ({ id: r.id })),
        { runId },
        { timeout: 5000 },
      );

      // Mark run as failed (not completed) so step-not-found check is reached
      await client.patch(`/api/v1/runs/${runId}`, {
        status: "failed",
      });

      const retryResponse = await client.post<{ error: string }>(
        `/api/v1/runs/${runId}/steps/non-existent-step/retry`,
        {},
      );

      expect(retryResponse.status).to.equal(404);
      expect(retryResponse.data.error).to.include("not found");
    });
  });
});
