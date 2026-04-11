const test = require("node:test");
const assert = require("node:assert/strict");
const { isTimelineRawUploadRequest } = require("../timelineUploadRoute");

test("timeline raw upload request detection works", () => {
  assert.equal(
    isTimelineRawUploadRequest({
      method: "PUT",
      path: "/api/storage/timeline-upload/upload_abc123",
    }),
    true,
  );
  assert.equal(
    isTimelineRawUploadRequest({
      method: "POST",
      path: "/api/storage/timeline-upload/upload_abc123",
    }),
    false,
  );
  assert.equal(
    isTimelineRawUploadRequest({
      method: "PUT",
      path: "/api/imports/session",
    }),
    false,
  );
});
