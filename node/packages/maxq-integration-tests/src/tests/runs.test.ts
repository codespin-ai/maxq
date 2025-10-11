import { expect } from "chai";
import { testDb, client } from "../test-setup.js";

describe("Runs API", () => {
  beforeEach(async () => {
    await testDb.truncateAllTables();
  });

  describe("POST /api/v1/runs", () => {
    it("should create a new run with minimal data", async () => {
      const response = await client.post("/api/v1/runs", {
        flowName: "test-workflow",
      });

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("id");
      expect(response.data).to.have.property("flowName", "test-workflow");
      expect(response.data).to.have.property("status", "pending");
      expect(response.data).to.have.property("createdAt");
    });

    it("should create a run with input data", async () => {
      const response = await client.post("/api/v1/runs", {
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
      const response = await client.post("/api/v1/runs", {
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
      const response = await client.post("/api/v1/runs", {
        // Missing required flowName
      });

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property("error");
    });
  });

  describe("GET /api/v1/runs/:id", () => {
    it("should get a run by id", async () => {
      // Create a run first
      const createResponse = await client.post("/api/v1/runs", {
        flowName: "test-flow",
        input: { test: "data" },
      });
      const runId = createResponse.data.id;

      // Get the run
      const response = await client.get(`/api/v1/runs/${runId}`);

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("id", runId);
      expect(response.data).to.have.property("flowName", "test-flow");
      expect(response.data).to.have.property("input");
      expect(response.data.input).to.deep.equal({ test: "data" });
    });

    it("should return 404 for non-existent run", async () => {
      const response = await client.get("/api/v1/runs/non-existent-id");

      expect(response.status).to.equal(404);
      expect(response.data).to.have.property("error");
    });
  });

  describe("PATCH /api/v1/runs/:id", () => {
    it("should update run status", async () => {
      // Create a run first
      const createResponse = await client.post("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Update the run
      const response = await client.patch(`/api/v1/runs/${runId}`, {
        status: "running",
      });

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("id", runId);
      expect(response.data).to.have.property("status", "running");
    });

    it("should update run output data", async () => {
      // Create a run first
      const createResponse = await client.post("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Update with output data
      const response = await client.patch(`/api/v1/runs/${runId}`, {
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
      const createResponse = await client.post("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Update with error
      const response = await client.patch(`/api/v1/runs/${runId}`, {
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
      const response = await client.patch("/api/v1/runs/non-existent-id", {
        status: "completed",
      });

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property("error");
    });

    it("should return 400 for invalid status", async () => {
      // Create a run first
      const createResponse = await client.post("/api/v1/runs", {
        flowName: "test-flow",
      });
      const runId = createResponse.data.id;

      // Try to update with invalid status
      const response = await client.patch(`/api/v1/runs/${runId}`, {
        status: "invalid-status",
      });

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property("error");
    });
  });

  describe("GET /api/v1/runs", () => {
    it("should list runs with pagination", async () => {
      // Create a few runs
      await client.post("/api/v1/runs", {
        flowName: "flow-1",
        input: { test: 1 },
      });
      await client.post("/api/v1/runs", {
        flowName: "flow-2",
        input: { test: 2 },
      });
      await client.post("/api/v1/runs", {
        flowName: "flow-3",
        input: { test: 3 },
      });

      // List runs with limit
      const response = await client.get("/api/v1/runs?limit=2");

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
      await client.post("/api/v1/runs", { flowName: "workflow-a" });
      await client.post("/api/v1/runs", { flowName: "workflow-b" });
      await client.post("/api/v1/runs", { flowName: "workflow-a" });

      // Filter by flowName
      const response = await client.get("/api/v1/runs?flowName=workflow-a");

      expect(response.status).to.equal(200);
      expect(response.data.data).to.have.lengthOf(2);
      expect(response.data.data[0]).to.have.property("flowName", "workflow-a");
      expect(response.data.data[1]).to.have.property("flowName", "workflow-a");
    });

    it("should filter runs by status", async () => {
      // Create runs with different statuses
      const run1Response = await client.post("/api/v1/runs", {
        flowName: "test-flow",
      });
      await client.post("/api/v1/runs", {
        flowName: "test-flow",
      });

      // Update one to running
      await client.patch(`/api/v1/runs/${run1Response.data.id}`, {
        status: "running",
      });

      // Filter by status
      const response = await client.get("/api/v1/runs?status=running");

      expect(response.status).to.equal(200);
      expect(response.data.data).to.have.lengthOf(1);
      expect(response.data.data[0]).to.have.property("status", "running");
    });

    it("should handle pagination with offset", async () => {
      // Create several runs
      for (let i = 0; i < 5; i++) {
        await client.post("/api/v1/runs", {
          flowName: "test-flow",
          input: { index: i },
        });
      }

      // Get second page
      const response = await client.get("/api/v1/runs?limit=2&offset=2");

      expect(response.status).to.equal(200);
      expect(response.data.data).to.have.lengthOf(2);
      expect(response.data.pagination).to.have.property("total", 5);
      expect(response.data.pagination).to.have.property("limit", 2);
      expect(response.data.pagination).to.have.property("offset", 2);
    });

    it("should sort runs by createdAt descending by default", async () => {
      // Create runs with delays to ensure different timestamps
      const run1 = await client.post("/api/v1/runs", { flowName: "flow-1" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const run2 = await client.post("/api/v1/runs", { flowName: "flow-2" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const run3 = await client.post("/api/v1/runs", { flowName: "flow-3" });

      const response = await client.get("/api/v1/runs");

      expect(response.status).to.equal(200);
      expect(response.data.data).to.have.lengthOf(3);
      // Most recent first (descending)
      expect(response.data.data[0].id).to.equal(run3.data.id);
      expect(response.data.data[1].id).to.equal(run2.data.id);
      expect(response.data.data[2].id).to.equal(run1.data.id);
    });
  });
});
