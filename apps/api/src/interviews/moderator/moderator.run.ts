import type { BaseMessage } from '@langchain/core/messages';
import type { Command, LangGraphRunnableConfig } from '@langchain/langgraph';
import { SPEAKING_NODES, type ModeratorGraph } from './moderator.graph.js';
import type { AwaitingAnswer, ModeratorStateUpdate, Turn } from './moderator.state.js';

export interface TurnHandlers {
  /** A chunk of text from a speaking node, as the model produces it. */
  onDelta(delta: string): void;
  /** A finished moderator turn, ready to save. Called after its deltas. */
  onModeratorTurn(turn: Turn): Promise<void>;
}

export type TurnOutcome =
  | { status: 'awaiting_answer'; awaiting: AwaitingAnswer }
  | { status: 'completed' };

export type ModeratorInput = Parameters<ModeratorGraph['stream']>[0];

/**
 * Runs the graph until it pauses for the next answer or finishes.
 *
 * Two stream modes at once: "messages" yields model tokens tagged with the
 * node that produced them (only speaking nodes are forwarded, so the decide
 * step's JSON never reaches the respondent), and "updates" yields each node's
 * state update when it finishes, which is where the moderator's turns are
 * picked up and saved.
 */
export async function runModeratorTurn(
  graph: ModeratorGraph,
  input: ModeratorInput | Command | null,
  config: LangGraphRunnableConfig,
  handlers: TurnHandlers,
): Promise<TurnOutcome> {
  const stream = await graph.stream(input as ModeratorInput, {
    ...config,
    streamMode: ['messages', 'updates'],
  });

  for await (const [mode, chunk] of stream as AsyncIterable<[string, unknown]>) {
    if (mode === 'messages') {
      const [message, metadata] = chunk as [BaseMessage, { langgraph_node?: string }];
      if (metadata.langgraph_node && SPEAKING_NODES.has(metadata.langgraph_node)) {
        const delta = message.text;
        if (delta) handlers.onDelta(delta);
      }
    } else if (mode === 'updates') {
      for (const [node, update] of Object.entries(chunk as Record<string, unknown>)) {
        if (node.startsWith('__')) continue;
        const turns = (update as ModeratorStateUpdate | undefined)?.turns;
        for (const turn of Array.isArray(turns) ? turns : []) {
          if (turn.role === 'moderator') await handlers.onModeratorTurn(turn);
        }
      }
    }
  }

  return currentOutcome(graph, config);
}

/** Reads the checkpoint to see whether the graph is paused on an answer or finished. */
export async function currentOutcome(
  graph: ModeratorGraph,
  config: LangGraphRunnableConfig,
): Promise<TurnOutcome> {
  const snapshot = await graph.getState(config);
  const pending = snapshot.tasks.flatMap((task) => task.interrupts)[0];
  if (pending) {
    return { status: 'awaiting_answer', awaiting: pending.value as AwaitingAnswer };
  }
  if (snapshot.next.length === 0) {
    return { status: 'completed' };
  }
  throw new Error(`Moderator stopped before ${snapshot.next.join(', ')} ran`);
}
