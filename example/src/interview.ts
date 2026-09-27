// A small interview that shows every part: kinds, guards, a jump, and a Jev decision that opens
// a follow-up only when the answer describes an exception.
import type { Decision, Interview } from "../../src/spec"

const exception: Decision = {
  type: "noul",
  instructions: "Does the answer describe an exception, a special case, or a condition under which the usual way changes?",
  criteria: { true: "Mentions unless, except, sometimes, it depends, or a named special case", false: "Describes one uniform way" },
  fallback: "yes",
}

export const interview: Interview = {
  id: "example-bakery",
  title: "How the bakery runs",
  respondent: "Sam",
  welcome: {
    heading: "Hi {name}. Tell us how the mornings really go.",
    body: "Answer in your own words. Press Talk to answer out loud instead of typing.\n\nSkip anything. Stop and come back any time; your answers are kept.",
  },
  farewell: { heading: "Thank you, {name}.", body: "That's everything. We'll turn this into a written description and send it back for you to correct." },
  glossary: { bake: "One oven load, planned the night before" },
  chapters: [
    {
      id: "orders",
      title: "Orders",
      lede: "Where the day's work comes from.",
      questions: [
        {
          id: "sources", kind: "multi", ask: "Where do orders come in from?",
          options: [{ value: "walkin", label: "Walk-ins" }, { value: "phone", label: "Phone" }, { value: "web", label: "The website" }, { value: "wholesale", label: "Wholesale accounts" }],
          why: "Which intake channels exist; each becomes its own path.", yields: "Feature: Taking orders — Background: the channels",
        },
        {
          id: "wholesale", kind: "long", ask: "Walk me through the last wholesale order.",
          context: "A café or shop that orders from you regularly. Start from when they got in touch and end when the van left.",
          hint: ["Who took the order, and how", "What had to be baked differently", "Anything that went wrong on the way"],
          when: { q: "sources", is: "wholesale" }, decide: { exception },
          why: "The wholesale path end to end, in order, from a real instance.", yields: "Scenario: a wholesale order — Given/When/Then",
        },
        {
          id: "wholesale_exception", kind: "long", ask: "You mentioned it sometimes goes differently. Tell me about the last time it did.",
          when: { q: "wholesale", decision: "exception", is: "yes" },
          why: "The exception the respondent named, as its own scenario.", yields: "Scenario: wholesale exception",
        },
        {
          id: "cutoff", kind: "choice", ask: "Is there a time after which you won't take an order for tomorrow?",
          options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No", next: "bake" }], note: true,
          why: "Whether a cut-off rule exists.", yields: "Rule: order cut-off",
        },
        {
          id: "cutoff_time", kind: "text", ask: "What time, and who can make an exception?",
          why: "The rule's value and its override.", yields: "Rule: order cut-off — Example",
        },
      ],
    },
    {
      id: "bake",
      title: "The bake",
      questions: [
        { id: "plan", kind: "long", ask: "How do you decide how much of each thing to bake?", context: "The night before, when tomorrow's bake gets planned.", hint: ["What you look at first", "Days or seasons that change the numbers"], why: "The planning rule and its inputs.", yields: "Rule: bake planning" },
        { id: "waste", kind: "number", unit: "loaves a day", ask: "On a normal day, how many loaves go unsold?", why: "Baseline for the planning rule.", yields: "Example: waste" },
        { id: "busy", kind: "scale", scale: ["Calm", "Busy", "Slammed"], ask: "How does a Saturday feel?", note: true, why: "Load that stresses the process.", yields: "Background: load" },
      ],
    },
  ],
}
