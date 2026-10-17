import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("refresh app store", { hours: 1 }, internal.appStore.refresh);
crons.interval("refresh lock screen weather", { minutes: 5 }, internal.integrations.refreshDue);

export default crons;
