const { Octokit } = require("@octokit/rest");

// Wait for any in-progress runs of the same workflow on this branch to complete before
// proceeding. In other words, if the current workflow is an instance of the "foo"
// workflow, and there's another "foo" workflow running for a different commit on the same
// branch as this one, wait for that workflow to complete before exiting (in order to
// prevent the current workflow from continuing).
// Inspired by https://github.com/softprops/turnstyle.
async function waitForInProgressRuns() {
    // See https://docs.github.com/en/free-pro-team@latest/actions/reference/environment-variables
    // for an explanation of each of these variables.
    const githubToken = process.env.GITHUB_TOKEN;
    const currentRunID = parseInt(process.env.GITHUB_RUN_ID, 10);
    const workflowName = process.env.GITHUB_WORKFLOW;
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
    const hugoRepo = "pulumi-hugo";
    const docsRepo = "docs";
    const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF.replace("refs/heads/", "");
    const status = "in_progress";

    const octokit = new Octokit({
        auth: githubToken,
    });

    // Given the current workflow name, fetch its ID.
    const docsWorkflows = await octokit.rest.actions.listRepoWorkflows({ owner, repo: docsRepo });
    const hugoWorkflows = await octokit.rest.actions.listRepoWorkflows({ owner, repo: hugoRepo });

    const docs_workflow_id = docsWorkflows.data.workflows.find(workflow => workflow.name === "Build and deploy testing").id;
    const hugo_workflow_id = hugoWorkflows.data.workflows.find(workflow => workflow.name === workflowName).id;

    // Fetch a paginated list of in-progress runs of the current workflow in docs.
    const docsRuns = await octokit.paginate(
        octokit.rest.actions.listWorkflowRuns.endpoint.merge({
            owner,
            repo: docsRepo,
            branch,
            workflow_id: docs_workflow_id,
            status,
        }),
    );

    // Fetch a paginated list of in-progress runs of the current workflow in pulumi-hugo.
    const hugoRuns = await octokit.paginate(
        octokit.rest.actions.listWorkflowRuns.endpoint.merge({
            owner,
            repo: hugoRepo,
            branch,
            workflow_id: hugo_workflow_id,
            status,
        }),
    );

    const currentHugoRun = hugoRuns.find(run => run.id === currentRunID);
    const recentDocs = docsRuns.sort((a, b) => b.id - a.id).filter(run => run.run_started_at < currentHugoRun.created_at);
    const recentHugo = hugoRuns.sort((a, b) => b.id - a.id).filter(run => run.run_started_at < currentHugoRun.created_at);

    if (recentDocs.length > 0 || recentHugo.length > 0) {
        // Sort in-progress runs descendingly, excluding the current one.
        console.log(`Found ${recentDocs.length} other ${workflowName} job(s) running on branch ${branch}.`);
        console.log(`Found ${recentHugo.length} other ${workflowName} job(s) running on branch ${branch}.`);

        const [mostRecent] = [...recentDocs, ...recentHugo];
        console.log(`Waiting for ${mostRecent.html_url} to complete before continuing.`);
        await Promise.resolve(setTimeout(waitForInProgressRuns, 60000)); // One minute.
    } else {
        console.log("Continuing.");
    }
}

// Unhandled errors that happen within Promises yield warnings, but do not (yet) cause the
// process to exit nonzero. Since we want this script to fail loudly when something goes
// wrong, we listen for unhandledRejection events and rethrow, exiting 1.
// https://nodejs.org/api/process.html#process_event_unhandledrejection
process.on("unhandledRejection", error => {
    throw error;
});

waitForInProgressRuns();