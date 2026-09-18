---
name: design-patterns
description: Reference guide for SOLID principles and GoF design patterns (Creational, Structural, Behavioral) tailored for TypeScript and NestJS enterprise architecture.
license: MIT
metadata:
  version: "1.0.0"
---

# SOLID Principles & GoF Design Patterns

Comprehensive reference guide for applying SOLID design principles and Gang of Four (GoF) design patterns in TypeScript and NestJS.

---

## 1. SOLID Principles

### S - Single Responsibility Principle (SRP)
- A class/service should have one, and only one, reason to change.
- **NestJS Application**: Separate transport handling (Controller), business logic (Service), validation (Pipe/Validator), data access (Repository), and external integrations (Adapter).
- **Anti-Pattern**: Fat controllers handling stream parsing, business rules, DB queries, and external API calls directly.

### O - Open/Closed Principle (OCP)
- Software entities should be open for extension, but closed for modification.
- **NestJS Application**: Use abstract strategy interfaces or pipeline handlers. Add new validators or storage providers by implementing new classes rather than modifying existing `switch` statements.

### L - Liskov Substitution Principle (LSP)
- Subtypes must be substitutable for their base types without altering program correctness.
- **NestJS Application**: Any storage adapter (e.g., `S3StorageAdapter`, `MemoryStorageAdapter`, `GcsStorageAdapter`) implementing `IObjectStorageService` must satisfy identical interface contracts and error handling conventions.

### I - Interface Segregation Principle (ISP)
- Clients should not be forced to depend upon interfaces they do not use.
- **NestJS Application**: Split monolithic interfaces into fine-grained interfaces (e.g., separate `IObjectReader`, `IObjectWriter`, `IMultipartUploader`).

### D - Dependency Inversion Principle (DIP)
- High-level modules should not depend on low-level modules. Both should depend on abstractions.
- **NestJS Application**: Inject interface tokens (`@Inject('OBJECT_STORAGE_SERVICE')`) instead of concrete SDK classes (`S3Client`).

---

## 2. Creational Patterns

### Factory Method
- Defines an interface for creating an object, but lets subclasses or helper functions alter the type of objects that will be created.
- **Use Case**: Creating storage adapters based on environment configuration (`STORAGE_DRIVER=s3 | memory | local`).

### Builder Pattern
- Separates the construction of a complex object from its representation.
- **Use Case**: Constructing retry policies, ingestion task options, or multi-step validation configurations.

---

## 3. Structural Patterns

### Adapter Pattern
- Converts the interface of a class into another interface clients expect.
- **Use Case**: Wrapping AWS SDK S3 client or MinIO client behind a unified `IObjectStorageService` interface.

### Decorator Pattern
- Attaches additional responsibilities to an object dynamically.
- **Use Case**: NestJS custom parameter decorators (e.g. `@UploadedStream()`), or wrapping storage operations with telemetry and retry decorators.

### Facade Pattern
- Provides a simplified interface to a library, a framework, or any other complex set of classes.
- **Use Case**: `IngestionService` orchestrating validation, storage staging, and database transactions behind a single `uploadDocument()` method.

---

## 4. Behavioral Patterns

### Strategy Pattern
- Defines a family of algorithms, encapsulates each one, and makes them interchangeable.
- **Use Case**: Error classification strategies (transient vs permanent error classifier), backoff calculation strategies (exponential with jitter vs fixed).

### Chain of Responsibility / Pipe-and-Filter
- Passes requests along a chain of handlers until one handles it or all validate it.
- **Use Case**: Stream validation pipeline executing sequential checks (Size -> Magic Bytes -> Archive Bomb -> Malicious Heuristics).

### Transactional Outbox / Observer Pattern
- Ensures reliable distributed message publishing by writing events to an outbox table within the local database transaction.
- **Use Case**: Decoupling synchronous API upload acceptance from asynchronous downstream parsing/chunking workers.

### Unit of Work / Repository Pattern
- Maintains a list of objects affected by a business transaction and coordinates writing out changes.
- **Use Case**: TypeORM `EntityManager` / `QueryRunner` executing atomic multi-entity commits and rollbacks.
