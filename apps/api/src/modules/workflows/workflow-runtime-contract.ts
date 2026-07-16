import type { WorkflowExecutionIssue, WorkflowStepType } from "@leadvirt/types";

const executableStepTypes = new Set<WorkflowStepType>([
  "TRIGGER",
  "CONDITION",
  "HANDOFF",
  "END",
]);

interface WorkflowContractStep {
  id: string;
  type: WorkflowStepType;
  name: string;
  config?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnabled(step: WorkflowContractStep) {
  return !isRecord(step.config) || step.config.enabled !== false;
}

function unsupportedStepMessage(step: WorkflowContractStep) {
  switch (step.type) {
    case "AI_MESSAGE":
      return "AI message delivery is not implemented for workflows.";
    case "QUESTION":
      return "Workflow question collection is not implemented.";
    case "ACTION":
      return "External workflow actions are not implemented.";
    case "DELAY":
      return "Durable delayed workflow execution is not implemented.";
    default:
      return `Workflow step type ${step.type} is not executable.`;
  }
}

export function workflowExecutionIssues(
  steps: readonly WorkflowContractStep[],
): WorkflowExecutionIssue[] {
  const issues: WorkflowExecutionIssue[] = steps
    .filter((step) => !executableStepTypes.has(step.type))
    .map((step) => ({
      code: "UNSUPPORTED_STEP",
      stepId: step.id,
      stepName: step.name,
      stepType: step.type,
      message: unsupportedStepMessage(step),
    }));

  const enabledTriggers = steps.filter((step) => step.type === "TRIGGER" && isEnabled(step));
  if (enabledTriggers.length === 0) {
    issues.push({
      code: "MISSING_TRIGGER",
      stepId: null,
      stepName: null,
      stepType: null,
      message: "An executable workflow requires one enabled trigger.",
    });
  } else if (enabledTriggers.length > 1) {
    issues.push({
      code: "MULTIPLE_TRIGGERS",
      stepId: null,
      stepName: null,
      stepType: "TRIGGER",
      message: "An executable workflow cannot contain multiple enabled triggers.",
    });
  }

  const endIndex = steps.findIndex((step) => step.type === "END" && isEnabled(step));
  if (endIndex >= 0) {
    for (const step of steps.slice(endIndex + 1).filter(isEnabled)) {
      issues.push({
        code: "UNREACHABLE_STEP",
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        message: `Workflow step ${step.name} appears after the workflow end and cannot execute.`,
      });
    }
  }

  return issues;
}

export function workflowExecutionMessage(issues: readonly WorkflowExecutionIssue[]) {
  if (issues.length === 0) return null;
  const names = issues
    .filter((issue) => issue.code === "UNSUPPORTED_STEP")
    .map((issue) => issue.stepName)
    .filter((name): name is string => Boolean(name));
  if (names.length > 0) {
    return `Workflow is blocked by unsupported steps: ${names.join(", ")}.`;
  }
  return issues[0]?.message ?? "Workflow is not executable.";
}

export function isExecutableWorkflowStepType(type: WorkflowStepType) {
  return executableStepTypes.has(type);
}
