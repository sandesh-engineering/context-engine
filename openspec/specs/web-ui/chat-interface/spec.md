# Web UI Chat Interface Specification

## Purpose

Provides a responsive and accessible web-based conversational interface allowing users to select conversations, browse on-demand message history, and chat interactively with the Knowledge Engine.

## Requirements

### Requirement: Conversation Selection and Navigation
The system SHALL present a sidebar list of previous conversations, allowing users to select any conversation or create a new conversation thread.

#### Scenario: User selects previous conversation
- **WHEN** user clicks on a conversation item in the sidebar list
- **THEN** the application activates the conversation, loads its recent message thread, and highlights the active item

#### Scenario: User initiates a new chat
- **WHEN** user clicks the "New Chat" button in the sidebar
- **THEN** the system clears the active message view and prepares an empty chat thread

### Requirement: On-Demand Historical Message Loading
The system SHALL load message history in paginated chunks on demand rather than loading all messages upfront, fetching older messages when scrolling upwards.

#### Scenario: Initial conversation load
- **WHEN** a conversation is opened
- **THEN** the system loads only the most recent message batch (e.g. 20 messages) and displays them in the message scroller

#### Scenario: User scrolls up to view older messages
- **WHEN** user scrolls to the top threshold of the message container
- **THEN** the system triggers a background request to fetch previous messages and prepends them seamlessly without jumping scroll position

### Requirement: Interactive Chat and Message Streaming
The system SHALL render real-time message bubbles with distinct styles for user and assistant, automatic downward scrolling during active streaming, and keyboard submission support.

#### Scenario: User sends a chat message
- **WHEN** user enters text into the message input and submits via Enter or click
- **THEN** the user's message is immediately added to the viewport, the input is cleared, and an assistant streaming placeholder is initialized

#### Scenario: Assistant response streaming and auto-scroll
- **WHEN** response tokens arrive from the server
- **THEN** the message bubble dynamically updates with markdown formatting and the message scroller keeps the latest text visible
