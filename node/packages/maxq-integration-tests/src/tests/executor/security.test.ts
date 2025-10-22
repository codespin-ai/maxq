/**
 * Integration tests for security utilities
 */

import { describe, it } from "mocha";
import { expect } from "chai";
import {
  validateName,
  resolveSafePath,
  sanitizeEnv,
  buildFlowPath,
  buildStepPath,
} from "@codespin/maxq-server/dist/executor/security.js";
import { mkdtemp, writeFile, chmod, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("Executor Security Utilities", () => {
  describe("validateName", () => {
    it("should accept valid flow names", () => {
      expect(() => validateName("my-flow", "flow")).to.not.throw();
      expect(() => validateName("my_flow", "flow")).to.not.throw();
      expect(() => validateName("MyFlow123", "flow")).to.not.throw();
      expect(() => validateName("flow-with-dashes", "flow")).to.not.throw();
    });

    it("should accept valid step names", () => {
      expect(() => validateName("my-step", "step")).to.not.throw();
      expect(() => validateName("step_1", "step")).to.not.throw();
      expect(() => validateName("StepName", "step")).to.not.throw();
    });

    it("should reject names with path separators", () => {
      expect(() => validateName("../etc", "flow")).to.throw(/Invalid.*name/);
      expect(() => validateName("foo/bar", "flow")).to.throw(/Invalid.*name/);
      expect(() => validateName("foo\\bar", "flow")).to.throw(/Invalid.*name/);
      expect(() => validateName("foo..bar", "flow")).to.throw(/Invalid.*name/);
    });

    it("should reject names with special characters", () => {
      expect(() => validateName("foo bar", "flow")).to.throw(/Invalid.*name/);
      expect(() => validateName("foo@bar", "flow")).to.throw(/Invalid.*name/);
      expect(() => validateName("foo$bar", "flow")).to.throw(/Invalid.*name/);
      expect(() => validateName("foo;bar", "flow")).to.throw(/Invalid.*name/);
    });

    it("should reject empty names", () => {
      expect(() => validateName("", "flow")).to.throw(/non-empty string/);
    });

    it("should reject non-string names", () => {
      expect(() => validateName(null as unknown as string, "flow")).to.throw(
        /non-empty string/,
      );
      expect(() =>
        validateName(undefined as unknown as string, "flow"),
      ).to.throw(/non-empty string/);
      expect(() => validateName(123 as unknown as string, "flow")).to.throw(
        /non-empty string/,
      );
    });
  });

  describe("resolveSafePath", () => {
    it("should resolve paths within base directory", () => {
      const base = "/flows";
      const resolved = resolveSafePath(base, "my-flow", "flow.sh");
      expect(resolved).to.include("/flows");
      expect(resolved).to.include("my-flow");
      expect(resolved).to.include("flow.sh");
    });

    it("should reject path traversal attempts", () => {
      const base = "/flows";
      expect(() => resolveSafePath(base, "..", "etc", "passwd")).to.throw(
        /Path traversal/,
      );
      expect(() => resolveSafePath(base, "flow", "..", "..", "etc")).to.throw(
        /Path traversal/,
      );
    });

    it("should handle multiple path segments", () => {
      const base = "/flows";
      const resolved = resolveSafePath(
        base,
        "my-flow",
        "steps",
        "my-step",
        "step.sh",
      );
      expect(resolved).to.include("/flows/my-flow/steps/my-step/step.sh");
    });
  });

  describe("sanitizeEnv", () => {
    it("should accept valid environment variable names", () => {
      const env = {
        MAXQ_RUN_ID: "123",
        MAXQ_FLOW_NAME: "my-flow",
        MY_VAR: "value",
        _UNDERSCORE: "test",
      };
      const sanitized = sanitizeEnv(env);
      expect(sanitized).to.deep.equal(env);
    });

    it("should reject invalid environment variable names", () => {
      expect(() => sanitizeEnv({ "invalid-name": "value" })).to.throw(
        /Invalid environment variable name/,
      );
      expect(() => sanitizeEnv({ "123ABC": "value" })).to.throw(
        /Invalid environment variable name/,
      );
      expect(() => sanitizeEnv({ "foo bar": "value" })).to.throw(
        /Invalid environment variable name/,
      );
    });

    it("should convert non-string values to strings", () => {
      const env = {
        NUMBER: 123 as unknown as string,
        BOOLEAN: true as unknown as string,
        OBJECT: { foo: "bar" } as unknown as string,
      };
      const sanitized = sanitizeEnv(env);
      expect(sanitized.NUMBER).to.equal("123");
      expect(sanitized.BOOLEAN).to.equal("true");
      expect(sanitized.OBJECT).to.equal("[object Object]");
    });

    it("should handle empty environment", () => {
      const sanitized = sanitizeEnv({});
      expect(sanitized).to.deep.equal({});
    });
  });

  describe("buildFlowPath", () => {
    it("should build valid flow path", () => {
      const path = buildFlowPath("/flows", "my-flow");
      expect(path).to.include("/flows");
      expect(path).to.include("my-flow");
      expect(path).to.include("flow.sh");
    });

    it("should validate flow name", () => {
      expect(() => buildFlowPath("/flows", "../etc")).to.throw();
      expect(() => buildFlowPath("/flows", "foo/bar")).to.throw();
    });

    it("should prevent path traversal", () => {
      expect(() => buildFlowPath("/flows", "..")).to.throw();
    });
  });

  describe("buildStepPath", () => {
    it("should build valid step path", () => {
      const path = buildStepPath("/flows", "my-flow", "my-step");
      expect(path).to.include("/flows");
      expect(path).to.include("my-flow");
      expect(path).to.include("steps");
      expect(path).to.include("my-step");
      expect(path).to.include("step.sh");
    });

    it("should validate flow and step names", () => {
      expect(() => buildStepPath("/flows", "../etc", "step")).to.throw();
      expect(() => buildStepPath("/flows", "flow", "../etc")).to.throw();
      expect(() => buildStepPath("/flows", "foo/bar", "step")).to.throw();
      expect(() => buildStepPath("/flows", "flow", "foo/bar")).to.throw();
    });

    it("should prevent path traversal", () => {
      expect(() => buildStepPath("/flows", "..", "step")).to.throw();
      expect(() => buildStepPath("/flows", "flow", "..")).to.throw();
    });
  });

  describe("validateExecutable (filesystem integration)", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "maxq-security-test-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should accept executable script", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(scriptPath, "#!/bin/bash\necho 'test'\n");
      await chmod(scriptPath, 0o755);

      const { validateExecutable } = await import(
        "@codespin/maxq-server/dist/executor/security.js"
      );
      await expect(validateExecutable(scriptPath)).to.not.be.rejected;
    });

    it("should reject non-executable file", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(scriptPath, "#!/bin/bash\necho 'test'\n");
      await chmod(scriptPath, 0o644);

      const { validateExecutable } = await import(
        "@codespin/maxq-server/dist/executor/security.js"
      );
      await expect(validateExecutable(scriptPath)).to.be.rejectedWith(
        /not executable/,
      );
    });

    it("should reject non-existent file", async () => {
      const scriptPath = join(tempDir, "nonexistent.sh");

      const { validateExecutable } = await import(
        "@codespin/maxq-server/dist/executor/security.js"
      );
      await expect(validateExecutable(scriptPath)).to.be.rejectedWith(
        /does not exist/,
      );
    });
  });
});
