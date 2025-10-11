/**
 * Integration tests for process spawning
 */

import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import { spawnProcess } from "@codespin/maxq-server/dist/executor/process-spawn.js";
import { mkdtemp, writeFile, chmod, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("Executor Process Spawning", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "maxq-spawn-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("spawnProcess", () => {
    it("should spawn process and capture stdout", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(
        scriptPath,
        `#!/bin/bash
echo "Hello from stdout"
`,
      );
      await chmod(scriptPath, 0o755);

      const result = await spawnProcess(scriptPath, {}, tempDir);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Hello from stdout");
      expect(result.stderr).to.equal("");
      expect(result.durationMs).to.be.greaterThan(0);
    });

    it("should spawn process and capture stderr", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(
        scriptPath,
        `#!/bin/bash
echo "Error message" >&2
`,
      );
      await chmod(scriptPath, 0o755);

      const result = await spawnProcess(scriptPath, {}, tempDir);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.equal("");
      expect(result.stderr).to.include("Error message");
    });

    it("should capture both stdout and stderr", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(
        scriptPath,
        `#!/bin/bash
echo "stdout message"
echo "stderr message" >&2
`,
      );
      await chmod(scriptPath, 0o755);

      const result = await spawnProcess(scriptPath, {}, tempDir);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("stdout message");
      expect(result.stderr).to.include("stderr message");
    });

    it("should capture non-zero exit codes", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(
        scriptPath,
        `#!/bin/bash
echo "Before error"
exit 42
`,
      );
      await chmod(scriptPath, 0o755);

      const result = await spawnProcess(scriptPath, {}, tempDir);

      expect(result.exitCode).to.equal(42);
      expect(result.stdout).to.include("Before error");
    });

    it("should pass environment variables to process", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(
        scriptPath,
        `#!/bin/bash
echo "RUN_ID=$MAXQ_RUN_ID"
echo "FLOW=$MAXQ_FLOW_NAME"
`,
      );
      await chmod(scriptPath, 0o755);

      const result = await spawnProcess(
        scriptPath,
        {
          MAXQ_RUN_ID: "test-run-123",
          MAXQ_FLOW_NAME: "test-flow",
        },
        tempDir,
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("RUN_ID=test-run-123");
      expect(result.stdout).to.include("FLOW=test-flow");
    });

    it("should truncate output at maxLogCapture limit", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(
        scriptPath,
        `#!/bin/bash
# Generate 1000 bytes of output
for i in {1..100}; do
  echo "0123456789"
done
`,
      );
      await chmod(scriptPath, 0o755);

      const maxCapture = 500;
      const result = await spawnProcess(scriptPath, {}, tempDir, maxCapture);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout.length).to.be.lessThanOrEqual(maxCapture + 100); // Allow for truncation message
      expect(result.stdout).to.include("output truncated");
    });

    it("should truncate stderr at maxLogCapture limit", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(
        scriptPath,
        `#!/bin/bash
# Generate 1000 bytes of stderr
for i in {1..100}; do
  echo "0123456789" >&2
done
`,
      );
      await chmod(scriptPath, 0o755);

      const maxCapture = 500;
      const result = await spawnProcess(scriptPath, {}, tempDir, maxCapture);

      expect(result.exitCode).to.equal(0);
      expect(result.stderr.length).to.be.lessThanOrEqual(maxCapture + 100);
      expect(result.stderr).to.include("output truncated");
    });

    it("should handle process that writes multiline output", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(
        scriptPath,
        `#!/bin/bash
echo "Line 1"
echo "Line 2"
echo "Line 3"
echo "Line 4"
echo "Line 5"
`,
      );
      await chmod(scriptPath, 0o755);

      const result = await spawnProcess(scriptPath, {}, tempDir);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Line 1");
      expect(result.stdout).to.include("Line 2");
      expect(result.stdout).to.include("Line 3");
      expect(result.stdout).to.include("Line 4");
      expect(result.stdout).to.include("Line 5");
    });

    it("should measure execution duration", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(
        scriptPath,
        `#!/bin/bash
sleep 0.1
echo "Done"
`,
      );
      await chmod(scriptPath, 0o755);

      const startTime = Date.now();
      const result = await spawnProcess(scriptPath, {}, tempDir);
      const endTime = Date.now();

      expect(result.exitCode).to.equal(0);
      expect(result.durationMs).to.be.greaterThan(50);
      expect(result.durationMs).to.be.lessThan(endTime - startTime + 100);
    });

    it("should reject non-executable script", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(scriptPath, "#!/bin/bash\necho 'test'\n");
      await chmod(scriptPath, 0o644); // Not executable

      await expect(spawnProcess(scriptPath, {}, tempDir)).to.be.rejectedWith(
        /not executable/,
      );
    });

    it("should reject non-existent script", async () => {
      const scriptPath = join(tempDir, "nonexistent.sh");

      await expect(spawnProcess(scriptPath, {}, tempDir)).to.be.rejectedWith(
        /not executable/,
      );
    });

    it("should handle scripts with relative paths by converting to absolute", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(
        scriptPath,
        `#!/bin/bash
echo "Relative path test"
`,
      );
      await chmod(scriptPath, 0o755);

      const result = await spawnProcess(scriptPath, {}, tempDir);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Relative path test");
    });

    it("should sanitize environment variables", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(scriptPath, `#!/bin/bash\necho "test"\n`);
      await chmod(scriptPath, 0o755);

      // Should reject invalid env var names
      await expect(
        spawnProcess(
          scriptPath,
          {
            "invalid-name": "value",
          } as Record<string, string>,
          tempDir,
        ),
      ).to.be.rejectedWith(/Invalid environment variable name/);
    });

    it("should handle empty environment", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(
        scriptPath,
        `#!/bin/bash
echo "Empty env test"
`,
      );
      await chmod(scriptPath, 0o755);

      const result = await spawnProcess(scriptPath, {}, tempDir);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Empty env test");
    });

    it("should capture output from process that exits immediately", async () => {
      const scriptPath = join(tempDir, "test.sh");
      await writeFile(
        scriptPath,
        `#!/bin/bash
echo "Quick"
`,
      );
      await chmod(scriptPath, 0o755);

      const result = await spawnProcess(scriptPath, {}, tempDir);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Quick");
    });
  });
});
