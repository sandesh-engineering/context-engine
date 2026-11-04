import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AppDataSource, dataSourceOptions } from '../data-source';
import { ConversationEntity, MessageEntity, MessageRole } from '../../chat/entities';

// ============================================================================
// CONFIGURATION & CLI ARGUMENT PARSING
// ============================================================================

interface SeedConfig {
  conversationsCount: number;
  messagesPerConversation: number;
  conversationBatchSize: number;
  messageBatchSize: number;
  truncateBeforeSeed: boolean;
}

function parseCliArgs(): SeedConfig {
  const args = process.argv.slice(2);
  let conversationsCount = 20000;
  let messagesPerConversation = 4;
  let truncateBeforeSeed = false;

  for (const arg of args) {
    if (arg.startsWith('--conversations=')) {
      const val = arg.split('=')[1] ?? '';
      conversationsCount = parseInt(val, 10) || conversationsCount;
    } else if (arg.startsWith('--messages-per-conv=')) {
      const val = arg.split('=')[1] ?? '';
      messagesPerConversation = parseInt(val, 10) || messagesPerConversation;
    } else if (arg.startsWith('--total=')) {
      const val = arg.split('=')[1] ?? '';
      const total = parseInt(val, 10) || 100000;
      // Distribute ~1:4 ratio (1 conversation + 4 messages = 5 total records)
      conversationsCount = Math.max(1, Math.floor(total / 5));
      messagesPerConversation = 4;
    } else if (arg === '--truncate' || arg === '--clean') {
      truncateBeforeSeed = true;
    }
  }

  return {
    conversationsCount,
    messagesPerConversation,
    conversationBatchSize: 2000,
    messageBatchSize: 4000,
    truncateBeforeSeed,
  };
}

// ============================================================================
// REALISTIC MOCK DATA CORPUS
// ============================================================================

const USERS = Array.from({ length: 250 }, (_, i) => `usr_${(i + 1000).toString(16)}`);

const TOPICS = [
  'PostgreSQL indexing & query planner tuning',
  'HNSW vector indexing performance with pgvector',
  'Distributed tracing setup using OpenTelemetry and Jaeger',
  'Resilience patterns: circuit breaker and retry with jitter',
  'Dead letter queue redrive policies in AWS SQS',
  'Transactional outbox pattern implementation with TypeORM',
  'Event loop lag optimization in Node.js microservices',
  'Next.js 15 Server Components and cache revalidation',
  'Loki log aggregation and Grafana Alloy configuration',
  'Secure JWT signing with asymmetric RS256 keys',
  'Kubernetes ingress controller path-based routing',
  'Redis cluster memory saturation and eviction policies',
  'Database connection pooling with PgBouncer',
  'Multipart streaming upload with bounded memory buffers',
  'Semantic chunking and recursive text splitting in RAG',
  'Ollama local LLM embedding latency benchmarks',
];

const USER_PROMPTS = [
  'How does the PostgreSQL query planner select between an index scan and a sequential scan on large tables?',
  'Can you explain how HNSW graphs differ from IVFFlat for vector search recall and indexing speed?',
  'What are the best practices for handling poisoned messages in an AWS SQS queue with DLQs?',
  'How can we prevent memory leaks when streaming large PDF files in a NestJS application?',
  'Explain the differences between major and minor garbage collection cycles in V8 runtime.',
  'How does the Transactional Outbox pattern guarantee at-least-once message delivery in microservices?',
  'What is the recommended approach for propagating W3C traceparent headers across async workers?',
  'How do we configure Grafana Alloy to scrape Docker container logs and ship them to Loki?',
];

const ASSISTANT_RESPONSES = [
  'The query planner compares estimated cost values (measured in arbitrary disk page fetch units). If the filter condition matches a large percentage of table pages, a sequential scan is chosen to avoid random disk I/O seek penalties. Adding VACUUM ANALYZE ensures accurate statistics.',
  'HNSW (Hierarchical Navigable Small World) provides superior search recall and sub-millisecond query latency compared to IVFFlat because it traverses a multi-layer proximity graph without requiring iterative retraining. However, it requires significantly more memory during index creation.',
  'For SQS poisoned message handling: 1) Configure a redrive policy with maxReceiveCount between 3 and 5. 2) Set visibility timeout higher than maximum task execution time. 3) Route failed messages to a Dead Letter Queue (DLQ) with CloudWatch alerts for manual inspection.',
  'To stream large files without memory exhaustion: Use Node.js stream pipes directly to AWS S3 managed upload or local disk storage with bounded chunks (e.g. 5MB) via Busboy. Avoid buffering the full file buffer into V8 heap memory.',
  'In the V8 engine, Minor GC (Scavenge) uses Cheney’s copying algorithm to rapidly clear short-lived objects from the Nursery space. Major GC (Mark-Sweep-Compact) pauses the event loop to collect long-lived objects in Old Space and defragment memory.',
  'The Transactional Outbox pattern atomically writes both the domain entity and the pending message event to the relational database within the exact same database transaction. A separate poller or CDC worker then reliably publishes to the broker.',
];

// ============================================================================
// DATA GENERATION HELPERS
// ============================================================================

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)] as T;
}

function getRandomTimestamp(daysAgoMax = 45): Date {
  const now = Date.now();
  const pastMs = Math.floor(Math.random() * daysAgoMax * 24 * 60 * 60 * 1000);
  return new Date(now - pastMs);
}

// ============================================================================
// SEED EXECUTION RUNNER
// ============================================================================

export async function seedConversations(): Promise<void> {
  const config = parseCliArgs();
  const totalMessagesTarget = config.conversationsCount * config.messagesPerConversation;
  const totalRecordsTarget = config.conversationsCount + totalMessagesTarget;

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        KNOWLEDGE ENGINE — HIGH-THROUGHPUT DATABASE SEED      ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Target Conversations : ${config.conversationsCount.toLocaleString().padEnd(36)} ║`);
  console.log(`║  Target Messages      : ${totalMessagesTarget.toLocaleString().padEnd(36)} ║`);
  console.log(`║  Total Mock Records   : ~${totalRecordsTarget.toLocaleString().padEnd(35)} ║`);
  console.log(`║  Database Host        : ${(process.env.DB_HOST || 'localhost').padEnd(36)} ║`);
  console.log(`║  Database Name        : ${(process.env.DB_NAME || 'knowledge_engine').padEnd(36)} ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Initialize DataSource with disabled SQL logging for maximum batch throughput
  const seedDataSource = new DataSource({
    ...dataSourceOptions,
    logging: false,
  });

  const startTime = Date.now();
  await seedDataSource.initialize();
  console.log('\n✔ Database connection established.');

  const conversationRepo = seedDataSource.getRepository(ConversationEntity);
  const messageRepo = seedDataSource.getRepository(MessageEntity);

  // 1. Optional Truncate
  if (config.truncateBeforeSeed) {
    console.log('\n⚠ Truncating existing messages and conversations...');
    await seedDataSource.query('TRUNCATE TABLE messages, conversations RESTART IDENTITY CASCADE;');
    console.log('✔ Existing records truncated.');
  }

  // 2. Generate and Insert Conversations in Batches
  console.log(`\n[1/2] Generating and inserting ${config.conversationsCount.toLocaleString()} conversations...`);
  const allConversationIds: { id: string; createdAt: Date }[] = [];
  let insertedConversations = 0;

  for (let i = 0; i < config.conversationsCount; i += config.conversationBatchSize) {
    const currentBatchSize = Math.min(config.conversationBatchSize, config.conversationsCount - i);
    const conversationBatch: Partial<ConversationEntity>[] = [];

    for (let j = 0; j < currentBatchSize; j++) {
      const convId = randomUUID();
      const createdAt = getRandomTimestamp(60);
      const updatedAt = new Date(createdAt.getTime() + Math.floor(Math.random() * 3600000));
      const topic = getRandomElement(TOPICS);

      conversationBatch.push({
        id: convId,
        userId: Math.random() > 0.15 ? getRandomElement(USERS) : undefined,
        title: topic,
        providerSessionId: Math.random() > 0.3 ? `sess_${randomUUID().slice(0, 12)}` : undefined,
        contextState: Math.random() > 0.5 ? [151644, 872, 198, 46487, 1964, 92531] : undefined,
        createdAt,
        updatedAt,
      });

      allConversationIds.push({ id: convId, createdAt });
    }

    await conversationRepo
      .createQueryBuilder()
      .insert()
      .into(ConversationEntity)
      .values(conversationBatch as any)
      .execute();

    insertedConversations += currentBatchSize;
    const progress = ((insertedConversations / config.conversationsCount) * 100).toFixed(1);
    process.stdout.write(`  ➔ Inserted ${insertedConversations.toLocaleString()} / ${config.conversationsCount.toLocaleString()} conversations (${progress}%)\r`);
  }
  console.log(`\n✔ Successfully inserted ${config.conversationsCount.toLocaleString()} conversations.`);

  // 3. Generate and Insert Messages in Batches
  console.log(`\n[2/2] Generating and inserting ~${totalMessagesTarget.toLocaleString()} messages...`);
  let insertedMessages = 0;
  let currentMessageBatch: Partial<MessageEntity>[] = [];

  for (let cIdx = 0; cIdx < allConversationIds.length; cIdx++) {
    const conv = allConversationIds[cIdx];
    if (!conv) continue;
    const turns = config.messagesPerConversation;

    for (let turn = 0; turn < turns; turn++) {
      const isUser = turn % 2 === 0;
      const role = isUser ? MessageRole.USER : MessageRole.ASSISTANT;
      const messageId = randomUUID();
      const messageTime = new Date(conv.createdAt.getTime() + turn * 15000);
      const content = isUser
        ? getRandomElement(USER_PROMPTS)
        : getRandomElement(ASSISTANT_RESPONSES);

      const hasCitations = !isUser && Math.random() > 0.25;
      const chunkId = randomUUID();

      currentMessageBatch.push({
        id: messageId,
        conversationId: conv.id,
        role,
        content,
        evidenceChunkIds: hasCitations ? [chunkId, randomUUID()] : undefined,
        citations: hasCitations
          ? [
              {
                chunkId,
                documentTitle: 'Internal Architecture & Resilience Guide',
                chunkIndex: Math.floor(Math.random() * 50),
                similarity: Number((0.82 + Math.random() * 0.16).toFixed(4)),
              },
            ]
          : undefined,
        insufficientEvidence: !isUser && Math.random() < 0.05,
        metadataJson: {
          traceId: randomUUID().replace(/-/g, ''),
          model: 'qwen3:4b',
          durationMs: isUser ? undefined : Math.floor(250 + Math.random() * 850),
        },
        createdAt: messageTime,
      });

      if (currentMessageBatch.length >= config.messageBatchSize) {
        await messageRepo
          .createQueryBuilder()
          .insert()
          .into(MessageEntity)
          .values(currentMessageBatch as any)
          .execute();

        insertedMessages += currentMessageBatch.length;
        currentMessageBatch = [];
        const msgProgress = ((insertedMessages / totalMessagesTarget) * 100).toFixed(1);
        process.stdout.write(`  ➔ Inserted ${insertedMessages.toLocaleString()} / ${totalMessagesTarget.toLocaleString()} messages (${msgProgress}%)\r`);
      }
    }
  }

  // Insert any remainder
  if (currentMessageBatch.length > 0) {
    await messageRepo
      .createQueryBuilder()
      .insert()
      .into(MessageEntity)
      .values(currentMessageBatch as any)
      .execute();
    insertedMessages += currentMessageBatch.length;
  }

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
  const totalInserted = insertedConversations + insertedMessages;
  const rate = Math.round(totalInserted / Number(elapsedSeconds));

  console.log(`\n✔ Successfully inserted ${insertedMessages.toLocaleString()} messages.`);
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(`🎉 Seeding complete in ${elapsedSeconds}s!`);
  console.log(`   - Conversations : ${insertedConversations.toLocaleString()}`);
  console.log(`   - Messages      : ${insertedMessages.toLocaleString()}`);
  console.log(`   - Total Entities: ${totalInserted.toLocaleString()} records`);
  console.log(`   - Throughput    : ~${rate.toLocaleString()} rows/second`);
  console.log('════════════════════════════════════════════════════════════════\n');

  await seedDataSource.destroy();
}

// Auto-run when executed directly via CLI
if (require.main === module) {
  seedConversations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Seeding failed:', err);
      process.exit(1);
    });
}
