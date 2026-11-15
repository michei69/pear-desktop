import { v } from "@pear/sdk/rpc";

export function validationMessage(issues: readonly v.BaseIssue<unknown>[]) {
  return issues
    .map((issue) => {
      const path = v.getDotPath(issue);
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
