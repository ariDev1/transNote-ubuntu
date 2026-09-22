import { tool } from "@opencode-ai/plugin"

const home = process.env.HOME || ""
const cli = home + "/.local/bin/transnote-agent"

async function run(argv: string[]): Promise<string> {
  if (home === "") {
    throw new Error("HOME is not set")
  }

  const proc = Bun.spawn([cli, ...argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  const clean = stdout.trim()

  // transnote-agent returns structured JSON on stdout for both success
  // and domain errors. Preserve that output even when its exit code is
  // non-zero so the agent sees the stable protocol response.
  if (clean !== "") {
    return clean
  }

  const detail = stderr.trim() || "no structured output"
  throw new Error(`transnote-agent exited ${exitCode}: ${detail}`)
}

export const status = tool({
  description: "Get the current TransNote agent-interface status.",
  args: {},
  async execute() {
    return run(["status"])
  },
})

export const list = tool({
  description: "List visible TransNote notes.",
  args: {},
  async execute() {
    return run(["list"])
  },
})

export const search = tool({
  description: "Search visible TransNote note titles and bodies.",
  args: {
    query: tool.schema.string().describe("Case-insensitive search text."),
  },
  async execute(args) {
    return run(["search", args.query])
  },
})

export const create = tool({
  description: "Create one private local TransNote note.",
  args: {
    title: tool.schema.string().describe("Note title. Can be empty when body is not empty."),
    body: tool.schema.string().describe("Note body. Can be empty when title is not empty."),
  },
  async execute(args) {
    return run(["create", "--title", args.title, "--body", args.body])
  },
})

export const comment = tool({
  description: "Add one comment to a visible TransNote note.",
  args: {
    noteId: tool.schema.string().describe("Target TransNote note ID."),
    text: tool.schema.string().describe("Comment text."),
  },
  async execute(args) {
    return run(["comment", args.noteId, "--text", args.text])
  },
})

export const share = tool({
  description: "Share one eligible local Agent-created TransNote note.",
  args: {
    noteId: tool.schema.string().describe("Target TransNote note ID."),
  },
  async execute(args) {
    return run(["share", args.noteId])
  },
})
