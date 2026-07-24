type KnowledgeDataAttribute =
  | "data-capability-id"
  | "data-guidance-rule-id"
  | "data-knowledge-document-id"
  | "data-knowledge-fact-id"
  | "data-knowledge-revision-id"
  | "data-knowledge-source-id"
  | "data-verification-fact-id";

const selectors: Record<KnowledgeDataAttribute, string> = {
  "data-capability-id": "[data-capability-id]",
  "data-guidance-rule-id": "[data-guidance-rule-id]",
  "data-knowledge-document-id": "[data-knowledge-document-id]",
  "data-knowledge-fact-id": "[data-knowledge-fact-id]",
  "data-knowledge-revision-id": "[data-knowledge-revision-id]",
  "data-knowledge-source-id": "[data-knowledge-source-id]",
  "data-verification-fact-id": "[data-verification-fact-id]",
};

export function findKnowledgeDataElement(
  attribute: KnowledgeDataAttribute,
  value: string,
  root: ParentNode = document,
) {
  return Array.from(root.querySelectorAll<HTMLElement>(selectors[attribute])).find(
    (element) => element.getAttribute(attribute) === value,
  );
}
