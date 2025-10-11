/**
 * Integration tests for DAG resolution
 */

import { describe, it } from "mocha";
import { expect } from "chai";
import {
  resolveDAG,
  type StepDefinition,
} from "@codespin/maxq-server/dist/executor/step-executor.js";

describe("Executor DAG Resolution", () => {
  describe("resolveDAG", () => {
    it("should resolve single step with no dependencies", () => {
      const steps: StepDefinition[] = [{ name: "step-1" }];

      const levels = resolveDAG(steps);

      expect(levels).to.have.lengthOf(1);
      expect(levels[0]).to.have.lengthOf(1);
      expect(levels[0][0].name).to.equal("step-1");
    });

    it("should resolve multiple independent steps in one level", () => {
      const steps: StepDefinition[] = [
        { name: "step-1" },
        { name: "step-2" },
        { name: "step-3" },
      ];

      const levels = resolveDAG(steps);

      expect(levels).to.have.lengthOf(1);
      expect(levels[0]).to.have.lengthOf(3);
      const names = levels[0].map((s) => s.name).sort();
      expect(names).to.deep.equal(["step-1", "step-2", "step-3"]);
    });

    it("should resolve linear dependency chain", () => {
      const steps: StepDefinition[] = [
        { name: "step-1" },
        { name: "step-2", dependsOn: ["step-1"] },
        { name: "step-3", dependsOn: ["step-2"] },
      ];

      const levels = resolveDAG(steps);

      expect(levels).to.have.lengthOf(3);
      expect(levels[0][0].name).to.equal("step-1");
      expect(levels[1][0].name).to.equal("step-2");
      expect(levels[2][0].name).to.equal("step-3");
    });

    it("should resolve diamond dependency pattern", () => {
      const steps: StepDefinition[] = [
        { name: "fetch" },
        { name: "process-a", dependsOn: ["fetch"] },
        { name: "process-b", dependsOn: ["fetch"] },
        { name: "combine", dependsOn: ["process-a", "process-b"] },
      ];

      const levels = resolveDAG(steps);

      expect(levels).to.have.lengthOf(3);

      // Level 0: fetch
      expect(levels[0]).to.have.lengthOf(1);
      expect(levels[0][0].name).to.equal("fetch");

      // Level 1: process-a and process-b (parallel)
      expect(levels[1]).to.have.lengthOf(2);
      const level1Names = levels[1].map((s) => s.name).sort();
      expect(level1Names).to.deep.equal(["process-a", "process-b"]);

      // Level 2: combine
      expect(levels[2]).to.have.lengthOf(1);
      expect(levels[2][0].name).to.equal("combine");
    });

    it("should resolve complex multi-level dependencies", () => {
      const steps: StepDefinition[] = [
        { name: "init" },
        { name: "fetch-a", dependsOn: ["init"] },
        { name: "fetch-b", dependsOn: ["init"] },
        { name: "process-a", dependsOn: ["fetch-a"] },
        { name: "process-b", dependsOn: ["fetch-b"] },
        { name: "aggregate", dependsOn: ["process-a", "process-b"] },
        { name: "format", dependsOn: ["aggregate"] },
      ];

      const levels = resolveDAG(steps);

      expect(levels).to.have.lengthOf(5);

      // Level 0: init
      expect(levels[0][0].name).to.equal("init");

      // Level 1: fetch-a, fetch-b
      expect(levels[1]).to.have.lengthOf(2);
      const level1Names = levels[1].map((s) => s.name).sort();
      expect(level1Names).to.deep.equal(["fetch-a", "fetch-b"]);

      // Level 2: process-a, process-b
      expect(levels[2]).to.have.lengthOf(2);
      const level2Names = levels[2].map((s) => s.name).sort();
      expect(level2Names).to.deep.equal(["process-a", "process-b"]);

      // Level 3: aggregate
      expect(levels[3][0].name).to.equal("aggregate");

      // Level 4: format
      expect(levels[4][0].name).to.equal("format");
    });

    it("should handle steps with multiple dependencies", () => {
      const steps: StepDefinition[] = [
        { name: "step-1" },
        { name: "step-2" },
        { name: "step-3" },
        { name: "step-4", dependsOn: ["step-1", "step-2", "step-3"] },
      ];

      const levels = resolveDAG(steps);

      expect(levels).to.have.lengthOf(2);

      // Level 0: step-1, step-2, step-3 (all parallel)
      expect(levels[0]).to.have.lengthOf(3);
      const level0Names = levels[0].map((s) => s.name).sort();
      expect(level0Names).to.deep.equal(["step-1", "step-2", "step-3"]);

      // Level 1: step-4
      expect(levels[1][0].name).to.equal("step-4");
    });

    it("should preserve step properties through resolution", () => {
      const steps: StepDefinition[] = [
        {
          name: "step-1",
          instances: 3,
          maxRetries: 2,
          env: { FOO: "bar" },
        },
        {
          name: "step-2",
          dependsOn: ["step-1"],
          instances: 1,
          maxRetries: 0,
        },
      ];

      const levels = resolveDAG(steps);

      expect(levels).to.have.lengthOf(2);

      // Check properties are preserved
      const step1 = levels[0][0];
      expect(step1.name).to.equal("step-1");
      expect(step1.instances).to.equal(3);
      expect(step1.maxRetries).to.equal(2);
      expect(step1.env).to.deep.equal({ FOO: "bar" });

      const step2 = levels[1][0];
      expect(step2.name).to.equal("step-2");
      expect(step2.instances).to.equal(1);
      expect(step2.maxRetries).to.equal(0);
    });

    it("should handle empty dependsOn array", () => {
      const steps: StepDefinition[] = [
        { name: "step-1", dependsOn: [] },
        { name: "step-2", dependsOn: [] },
      ];

      const levels = resolveDAG(steps);

      expect(levels).to.have.lengthOf(1);
      expect(levels[0]).to.have.lengthOf(2);
    });

    it("should detect circular dependencies (direct)", () => {
      const steps: StepDefinition[] = [
        { name: "step-1", dependsOn: ["step-2"] },
        { name: "step-2", dependsOn: ["step-1"] },
      ];

      expect(() => resolveDAG(steps)).to.throw(/Circular dependency detected/);
    });

    it("should detect circular dependencies (indirect)", () => {
      const steps: StepDefinition[] = [
        { name: "step-1", dependsOn: ["step-3"] },
        { name: "step-2", dependsOn: ["step-1"] },
        { name: "step-3", dependsOn: ["step-2"] },
      ];

      expect(() => resolveDAG(steps)).to.throw(/Circular dependency detected/);
    });

    it("should detect self-referencing dependency", () => {
      const steps: StepDefinition[] = [
        { name: "step-1", dependsOn: ["step-1"] },
      ];

      expect(() => resolveDAG(steps)).to.throw(/Circular dependency detected/);
    });

    it("should reject dependency on non-existent step", () => {
      const steps: StepDefinition[] = [
        { name: "step-1" },
        { name: "step-2", dependsOn: ["nonexistent-step"] },
      ];

      expect(() => resolveDAG(steps)).to.throw(
        /depends on unknown step "nonexistent-step"/,
      );
    });

    it("should handle empty steps array", () => {
      const steps: StepDefinition[] = [];

      const levels = resolveDAG(steps);

      expect(levels).to.be.an("array").with.lengthOf(0);
    });

    it("should resolve wide parallel execution", () => {
      const steps: StepDefinition[] = [];
      for (let i = 1; i <= 10; i++) {
        steps.push({ name: `parallel-step-${i}` });
      }

      const levels = resolveDAG(steps);

      expect(levels).to.have.lengthOf(1);
      expect(levels[0]).to.have.lengthOf(10);
    });

    it("should resolve deep sequential execution", () => {
      const steps: StepDefinition[] = [{ name: "step-1" }];
      for (let i = 2; i <= 10; i++) {
        steps.push({
          name: `step-${i}`,
          dependsOn: [`step-${i - 1}`],
        });
      }

      const levels = resolveDAG(steps);

      expect(levels).to.have.lengthOf(10);
      for (let i = 0; i < 10; i++) {
        expect(levels[i]).to.have.lengthOf(1);
        expect(levels[i][0].name).to.equal(`step-${i + 1}`);
      }
    });

    it("should handle mixed sequential and parallel steps", () => {
      const steps: StepDefinition[] = [
        { name: "init" },
        { name: "parallel-1", dependsOn: ["init"] },
        { name: "parallel-2", dependsOn: ["init"] },
        { name: "parallel-3", dependsOn: ["init"] },
        { name: "sequential-1", dependsOn: ["parallel-1"] },
        { name: "sequential-2", dependsOn: ["sequential-1"] },
        {
          name: "final",
          dependsOn: ["parallel-2", "parallel-3", "sequential-2"],
        },
      ];

      const levels = resolveDAG(steps);

      expect(levels).to.have.lengthOf(5);

      // Level 0: init
      expect(levels[0][0].name).to.equal("init");

      // Level 1: parallel-1, parallel-2, parallel-3
      expect(levels[1]).to.have.lengthOf(3);

      // Level 2: sequential-1
      expect(levels[2][0].name).to.equal("sequential-1");

      // Level 3: sequential-2
      expect(levels[3][0].name).to.equal("sequential-2");

      // Level 4: final
      expect(levels[4][0].name).to.equal("final");
    });

    it("should handle fan-out then fan-in pattern", () => {
      const steps: StepDefinition[] = [
        { name: "source" },
        { name: "worker-1", dependsOn: ["source"] },
        { name: "worker-2", dependsOn: ["source"] },
        { name: "worker-3", dependsOn: ["source"] },
        { name: "worker-4", dependsOn: ["source"] },
        {
          name: "sink",
          dependsOn: ["worker-1", "worker-2", "worker-3", "worker-4"],
        },
      ];

      const levels = resolveDAG(steps);

      expect(levels).to.have.lengthOf(3);
      expect(levels[0][0].name).to.equal("source");
      expect(levels[1]).to.have.lengthOf(4); // All workers parallel
      expect(levels[2][0].name).to.equal("sink");
    });
  });
});
