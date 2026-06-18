# SOP Subtask Implementation Guide

Use this pattern when turning a service SOP and ClickUp-friendly breakdown into
automated ClickUp subtasks.

## Source Inputs

- The full SOP is source context.
- The ClickUp subtask breakdown is the implementation source of truth when it
  already contains titles, ordering, stage labels, descriptions, done criteria,
  SOP references, and escalation rules.

## Implementation Target

Add subtasks to the relevant service in `lib/onboarding/services.ts`:

```ts
sopSteps: [
    {
        key: "stable-lowercase-slug",
        title: "Human ClickUp subtask title",
        description: [
            "Stage: Basic",
            "",
            "Goal: ...",
            "",
            "Steps:",
            "1. ...",
            "",
            "Done when: ...",
            "",
            "SOP ref: ...",
            "",
            "Escalate if: ...",
        ].join("\n"),
    },
]
```

## Required Rules

- Preserve the breakdown order exactly. ClickUp subtask names are automatically
  prefixed with `01`, `02`, etc. by `ensureClientServiceTasks`.
- Use stable ASCII-only keys. Do not renumber keys if a title changes later.
- Put stage labels at the top of the description, e.g. `Stage: Basic`,
  `Stage: Advanced - skip on first run`, `Stage: Ongoing`, or
  `Stage: Situational`.
- Keep descriptions ClickUp-readable with clear sections: Goal, Tools if
  relevant, Steps, Done when, SOP ref, Escalate if.
- Do not encode SOP subtasks as onboarding modules. SOP subtasks belong under
  service fulfilment tasks in ClickUp, not in the client onboarding portal.
- Add or update tests in `tests/onboarding.test.ts` so every configured service
  has unique SOP keys and the new service has the expected ordered key list.

## Runtime Behavior

When a client completes all onboarding steps, `syncClientOnboardingStepToClickUp`
calls `ensureClientServiceTasks`, which:

- creates one parent ClickUp task per selected fulfilment service;
- creates one ClickUp subtask per `sopSteps` entry;
- saves each created ClickUp item in `client_clickup_items` so reruns are
  idempotent.

If SOPs should be created earlier than onboarding completion, change the
workflow in `lib/client-messages/clickup-channel-setup.ts` deliberately rather
than duplicating task creation elsewhere.
