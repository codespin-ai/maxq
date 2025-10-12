/**
 * Integration tests for flow discovery
 */

import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import {
  discoverFlows,
  getFlow,
} from "@codespin/maxq-server/dist/executor/flow-discovery.js";
import { mkdtemp, writeFile, chmod, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("Executor Flow Discovery", () => {
  let flowsRoot: string;

  beforeEach(async () => {
    flowsRoot = await mkdtemp(join(tmpdir(), "maxq-flows-test-"));
  });

  afterEach(async () => {
    await rm(flowsRoot, { recursive: true, force: true });
  });

  describe("discoverFlows", () => {
    it("should discover flow with executable flow.sh", async () => {
      // Create flow directory structure
      const flowDir = join(flowsRoot, "test-flow");
      await mkdir(flowDir);
      const flowScript = join(flowDir, "flow.sh");
      await writeFile(flowScript, "#!/bin/bash\necho 'test'\n");
      await chmod(flowScript, 0o755);

      const flows = await discoverFlows(flowsRoot);

      expect(flows).to.have.lengthOf(1);
      expect(flows[0]!.name).to.equal("test-flow");
      expect(flows[0]!.path).to.equal(flowDir);
      expect(flows[0]!.steps).to.be.an("array");
    });

    it("should discover multiple flows", async () => {
      // Create multiple flows
      for (const flowName of ["flow-1", "flow-2", "flow-3"]) {
        const flowDir = join(flowsRoot, flowName);
        await mkdir(flowDir);
        const flowScript = join(flowDir, "flow.sh");
        await writeFile(flowScript, "#!/bin/bash\necho 'test'\n");
        await chmod(flowScript, 0o755);
      }

      const flows = await discoverFlows(flowsRoot);

      expect(flows).to.have.lengthOf(3);
      const flowNames = flows.map((f) => f.name).sort();
      expect(flowNames).to.deep.equal(["flow-1", "flow-2", "flow-3"]);
    });

    it("should skip directories without flow.sh", async () => {
      // Create flow with flow.sh
      const flow1Dir = join(flowsRoot, "valid-flow");
      await mkdir(flow1Dir);
      const flow1Script = join(flow1Dir, "flow.sh");
      await writeFile(flow1Script, "#!/bin/bash\necho 'test'\n");
      await chmod(flow1Script, 0o755);

      // Create directory without flow.sh
      const invalidDir = join(flowsRoot, "invalid-flow");
      await mkdir(invalidDir);

      const flows = await discoverFlows(flowsRoot);

      expect(flows).to.have.lengthOf(1);
      expect(flows[0]!.name).to.equal("valid-flow");
    });

    it("should skip directories with non-executable flow.sh", async () => {
      // Create flow with executable flow.sh
      const executableDir = join(flowsRoot, "executable-flow");
      await mkdir(executableDir);
      const executableScript = join(executableDir, "flow.sh");
      await writeFile(executableScript, "#!/bin/bash\necho 'test'\n");
      await chmod(executableScript, 0o755);

      // Create flow with non-executable flow.sh
      const nonExecDir = join(flowsRoot, "non-executable-flow");
      await mkdir(nonExecDir);
      const nonExecScript = join(nonExecDir, "flow.sh");
      await writeFile(nonExecScript, "#!/bin/bash\necho 'test'\n");
      await chmod(nonExecScript, 0o644);

      const flows = await discoverFlows(flowsRoot);

      expect(flows).to.have.lengthOf(1);
      expect(flows[0]!.name).to.equal("executable-flow");
    });

    it("should discover steps within flow", async () => {
      // Create flow with steps
      const flowDir = join(flowsRoot, "flow-with-steps");
      await mkdir(flowDir);
      const flowScript = join(flowDir, "flow.sh");
      await writeFile(flowScript, "#!/bin/bash\necho 'test'\n");
      await chmod(flowScript, 0o755);

      // Create steps directory
      const stepsDir = join(flowDir, "steps");
      await mkdir(stepsDir);

      // Create multiple steps
      for (const stepName of ["step-1", "step-2", "step-3"]) {
        const stepDir = join(stepsDir, stepName);
        await mkdir(stepDir);
        const stepScript = join(stepDir, "step.sh");
        await writeFile(stepScript, "#!/bin/bash\necho 'step'\n");
        await chmod(stepScript, 0o755);
      }

      const flows = await discoverFlows(flowsRoot);

      expect(flows).to.have.lengthOf(1);
      expect(flows[0]!.name).to.equal("flow-with-steps");
      expect(flows[0]!.steps).to.have.lengthOf(3);
      const stepNames = flows[0]!.steps.sort();
      expect(stepNames).to.deep.equal(["step-1", "step-2", "step-3"]);
    });

    it("should skip non-executable steps", async () => {
      // Create flow
      const flowDir = join(flowsRoot, "flow-mixed-steps");
      await mkdir(flowDir);
      const flowScript = join(flowDir, "flow.sh");
      await writeFile(flowScript, "#!/bin/bash\necho 'test'\n");
      await chmod(flowScript, 0o755);

      // Create steps directory
      const stepsDir = join(flowDir, "steps");
      await mkdir(stepsDir);

      // Create executable step
      const execStepDir = join(stepsDir, "executable-step");
      await mkdir(execStepDir);
      const execStepScript = join(execStepDir, "step.sh");
      await writeFile(execStepScript, "#!/bin/bash\necho 'step'\n");
      await chmod(execStepScript, 0o755);

      // Create non-executable step
      const nonExecStepDir = join(stepsDir, "non-executable-step");
      await mkdir(nonExecStepDir);
      const nonExecStepScript = join(nonExecStepDir, "step.sh");
      await writeFile(nonExecStepScript, "#!/bin/bash\necho 'step'\n");
      await chmod(nonExecStepScript, 0o644);

      const flows = await discoverFlows(flowsRoot);

      expect(flows).to.have.lengthOf(1);
      expect(flows[0]!.steps).to.have.lengthOf(1);
      expect(flows[0]!.steps[0]!).to.equal("executable-step");
    });

    it("should handle flow without steps directory", async () => {
      // Create flow without steps directory
      const flowDir = join(flowsRoot, "flow-no-steps");
      await mkdir(flowDir);
      const flowScript = join(flowDir, "flow.sh");
      await writeFile(flowScript, "#!/bin/bash\necho 'test'\n");
      await chmod(flowScript, 0o755);

      const flows = await discoverFlows(flowsRoot);

      expect(flows).to.have.lengthOf(1);
      expect(flows[0]!.name).to.equal("flow-no-steps");
      expect(flows[0]!.steps).to.be.an("array").with.lengthOf(0);
    });

    it("should handle empty flows directory", async () => {
      const flows = await discoverFlows(flowsRoot);
      expect(flows).to.be.an("array").with.lengthOf(0);
    });

    it("should skip files in root (only directories)", async () => {
      // Create a file in root
      const fileInRoot = join(flowsRoot, "not-a-flow.txt");
      await writeFile(fileInRoot, "test");

      // Create valid flow
      const flowDir = join(flowsRoot, "valid-flow");
      await mkdir(flowDir);
      const flowScript = join(flowDir, "flow.sh");
      await writeFile(flowScript, "#!/bin/bash\necho 'test'\n");
      await chmod(flowScript, 0o755);

      const flows = await discoverFlows(flowsRoot);

      expect(flows).to.have.lengthOf(1);
      expect(flows[0]!.name).to.equal("valid-flow");
    });
  });

  describe("getFlow", () => {
    it("should get specific flow by name", async () => {
      // Create multiple flows
      for (const flowName of ["flow-1", "flow-2", "target-flow"]) {
        const flowDir = join(flowsRoot, flowName);
        await mkdir(flowDir);
        const flowScript = join(flowDir, "flow.sh");
        await writeFile(flowScript, "#!/bin/bash\necho 'test'\n");
        await chmod(flowScript, 0o755);
      }

      const flow = await getFlow(flowsRoot, "target-flow");

      expect(flow).to.not.be.null;
      expect(flow!.name).to.equal("target-flow");
      expect(flow!.path).to.include("target-flow");
    });

    it("should get flow with steps", async () => {
      // Create flow with steps
      const flowDir = join(flowsRoot, "test-flow");
      await mkdir(flowDir);
      const flowScript = join(flowDir, "flow.sh");
      await writeFile(flowScript, "#!/bin/bash\necho 'test'\n");
      await chmod(flowScript, 0o755);

      // Create steps
      const stepsDir = join(flowDir, "steps");
      await mkdir(stepsDir);
      for (const stepName of ["step-a", "step-b"]) {
        const stepDir = join(stepsDir, stepName);
        await mkdir(stepDir);
        const stepScript = join(stepDir, "step.sh");
        await writeFile(stepScript, "#!/bin/bash\necho 'step'\n");
        await chmod(stepScript, 0o755);
      }

      const flow = await getFlow(flowsRoot, "test-flow");

      expect(flow).to.not.be.null;
      expect(flow!.name).to.equal("test-flow");
      expect(flow!.steps).to.have.lengthOf(2);
      expect(flow!.steps.sort()).to.deep.equal(["step-a", "step-b"]);
    });

    it("should return null for non-existent flow", async () => {
      const flow = await getFlow(flowsRoot, "nonexistent-flow");
      expect(flow).to.be.null;
    });

    it("should return null for non-executable flow", async () => {
      // Create flow with non-executable script
      const flowDir = join(flowsRoot, "non-executable-flow");
      await mkdir(flowDir);
      const flowScript = join(flowDir, "flow.sh");
      await writeFile(flowScript, "#!/bin/bash\necho 'test'\n");
      await chmod(flowScript, 0o644);

      const flow = await getFlow(flowsRoot, "non-executable-flow");
      expect(flow).to.be.null;
    });

    it("should return null for directory without flow.sh", async () => {
      // Create directory without flow.sh
      const flowDir = join(flowsRoot, "no-script-flow");
      await mkdir(flowDir);

      const flow = await getFlow(flowsRoot, "no-script-flow");
      expect(flow).to.be.null;
    });
  });
});
