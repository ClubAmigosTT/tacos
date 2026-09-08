// Placeholder for BullMQ jobs. This process is deliberately separate from the HTTP API
// so image processing, notifications and score refreshes cannot block user requests.
console.log('tacos-worker ready');
setInterval(() => undefined, 60_000);
