function isTimelineRawUploadRequest(req) {
  return (
    req?.method === "PUT" &&
    typeof req?.path === "string" &&
    req.path.startsWith("/api/storage/timeline-upload/")
  );
}

module.exports = {
  isTimelineRawUploadRequest,
};
