import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("refresh app store", { hours: 6 }, internal.appStore.refresh);

export default crons;
