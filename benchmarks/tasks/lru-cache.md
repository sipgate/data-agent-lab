---
id: lru-cache
language: python
difficulty: medium
tags: [data-structure, algorithms]
timeout_s: 120
---

# Task: LRU Cache

Implement an LRU (Least Recently Used) cache with O(1) `get` and `put`.

## API

```python
class LRUCache:
    def __init__(self, capacity: int): ...
    def get(self, key: int) -> int:
        """Return the value if key exists, else -1. Marks key as most recently used."""
    def put(self, key: int, value: int) -> None:
        """Insert or update. Evict LRU if over capacity."""
```

## Acceptance criteria

- `get` and `put` run in O(1) average time.
- After a `put` that exceeds capacity, the least recently used key is evicted.
- A `get` on an existing key marks it most-recently-used.
- Capacity is a positive int; behavior for `capacity <= 0` is undefined (your call).

## Test cases (must pass)

```python
c = LRUCache(2)
c.put(1, 1)
c.put(2, 2)
assert c.get(1) == 1
c.put(3, 3)          # evicts key 2
assert c.get(2) == -1
c.put(4, 4)          # evicts key 1
assert c.get(1) == -1
assert c.get(3) == 3
assert c.get(4) == 4
```

## Notes

- Use `collections.OrderedDict` or implement the doubly-linked-list + dict combo yourself.
- No external dependencies.
