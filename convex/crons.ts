import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("refresh app store", { hours: 1 }, internal.appStore.refresh);
// Every integration due a refresh (each sets its own next time).
crons.interval("refresh lock screen integrations", { minutes: 1 }, internal.integrations.refreshDue);

export default crons;
