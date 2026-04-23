const test = require("node:test");
const assert = require("node:assert/strict");

const { TimelineService } = require("../src/services/timeline-service");

function createService() {
  const calls = [];
  const service = new TimelineService({
    config: {
      stateDir: "/tmp/cyberboss-state",
      timelineScreenshotQueueFile: "/tmp/cyberboss-timeline-service-test.json",
    },
    timelineIntegration: {
      async runSubcommand(subcommand, args) {
        calls.push({ subcommand, args });
        if (subcommand === "read") {
          return {
            stdout: JSON.stringify({
              date: "2026-04-21",
              exists: true,
              status: "draft",
              updatedAt: "2026-04-21T03:10:00+08:00",
              eventCount: 1,
              events: [{ id: "evt-1", title: "Deep work" }],
            }),
          };
        }
        if (subcommand === "categories") {
          return {
            stdout: JSON.stringify({
              categoryCount: 1,
              categories: [{ id: "work", label: "Work", children: [] }],
            }),
          };
        }
        if (subcommand === "proposals") {
          return {
            stdout: JSON.stringify({
              date: "2026-04-21",
              proposalCount: 1,
              proposals: [{ id: "proposal-1", label: "Coding", parentId: "coding" }],
            }),
          };
        }
        if (subcommand === "serve") {
          return { url: "http://127.0.0.1:4317" };
        }
        if (subcommand === "dev") {
          return { url: "http://127.0.0.1:4318" };
        }
        return {};
      },
    },
    sessionStore: {
      listBindings() {
        return [];
      },
    },
  });
  return { service, calls };
}

test("timeline service parses read JSON output", async () => {
  const { service, calls } = createService();
  const result = await service.read({ date: "2026-04-21" });

  assert.equal(result.data.exists, true);
  assert.equal(result.data.eventCount, 1);
  assert.deepEqual(calls, [
    {
      subcommand: "read",
      args: ["--date", "2026-04-21"],
    },
  ]);
});

test("timeline service parses category JSON output", async () => {
  const { service, calls } = createService();
  const result = await service.listCategories();

  assert.equal(result.data.categoryCount, 1);
  assert.equal(result.data.categories[0].id, "work");
  assert.deepEqual(calls, [
    {
      subcommand: "categories",
      args: [],
    },
  ]);
});

test("timeline service parses proposal JSON output", async () => {
  const { service, calls } = createService();
  const result = await service.listProposals({ date: "2026-04-21" });

  assert.equal(result.data.proposalCount, 1);
  assert.equal(result.data.proposals[0].id, "proposal-1");
  assert.deepEqual(calls, [
    {
      subcommand: "proposals",
      args: ["--date", "2026-04-21"],
    },
  ]);
});

test("timeline service serializes structured events into timeline JSON payload", async () => {
  const { service, calls } = createService();
  await service.write({
    date: "2026-04-21",
    events: [
      {
        startAt: "2026-04-21T02:00:00+08:00",
        endAt: "2026-04-21T03:10:00+08:00",
        categoryId: "work",
        subcategoryId: "coding",
        description: "project tools refactor",
      },
    ],
  });

  assert.deepEqual(calls, [
    {
      subcommand: "write",
      args: [
        "--date", "2026-04-21",
        "--events-json", JSON.stringify({
          events: [
            {
              startAt: "2026-04-21T02:00:00+08:00",
              endAt: "2026-04-21T03:10:00+08:00",
              categoryId: "work",
              subcategoryId: "coding",
              description: "project tools refactor",
            },
          ],
        }),
      ],
    },
  ]);
});

test("timeline service rejects mixed structured and raw event sources", async () => {
  const { service } = createService();
  await assert.rejects(async () => {
    await service.write({
      date: "2026-04-21",
      events: [],
      eventsJson: "{\"events\":[]}",
    });
  }, /Use only one of events, eventsJson, or eventsFile/);
});

test("timeline service serializes structured screenshot options", async () => {
  const { service, calls } = createService();
  const result = await service.captureScreenshot({
    outputFile: "/tmp/timeline-shot.png",
    selector: "analytics",
    range: "day",
    date: "2026-04-21",
    category: "work",
    subcategory: "coding",
    width: 1440,
    height: 1200,
    sidePadding: 24,
    locale: "zh-CN",
  });

  assert.equal(result.outputFile, "/tmp/timeline-shot.png");
  assert.deepEqual(calls, [
    {
      subcommand: "screenshot",
      args: [
        "--output", "/tmp/timeline-shot.png",
        "--selector", "analytics",
        "--range", "day",
        "--date", "2026-04-21",
        "--category", "work",
        "--subcategory", "coding",
        "--width", "1440",
        "--height", "1200",
        "--side-padding", "24",
        "--locale", "zh-CN",
      ],
    },
  ]);
});

test("timeline service returns serve startup url", async () => {
  const { service } = createService();
  const result = await service.serve({ locale: "zh-CN" });
  assert.equal(result.url, "http://127.0.0.1:4317");
});

test("timeline service returns dev startup url", async () => {
  const { service } = createService();
  const result = await service.dev({ locale: "zh-CN" });
  assert.equal(result.url, "http://127.0.0.1:4318");
});
