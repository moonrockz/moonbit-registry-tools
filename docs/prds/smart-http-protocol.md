# PRD: Smart HTTP Protocol Support

## Status: Future Enhancement

## Problem Statement

The initial implementation uses Git Dumb HTTP protocol for serving the package index. While simple to implement, this approach has limitations:

1. **Full Clone Required**: Clients must clone the entire index repository on first access
2. **Inefficient Updates**: Updates require fetching all changed objects, not just deltas
3. **No Native Push Support**: Publishing packages requires manual git operations
4. **Limited Authentication**: No built-in authentication mechanism

## Proposed Solution

Implement Git Smart HTTP protocol support, which provides:

1. **Efficient Delta Transfers**: Only transfer changed objects using git's packfile protocol
2. **Native Push Support**: Enable `git push` for publishing packages directly
3. **Authentication Integration**: Support HTTP Basic/Digest auth or custom auth middleware
4. **Better Performance**: Negotiate minimal data transfer with capability advertisement

## Technical Approach

### Endpoints to Implement

```
GET  /git/index/info/refs?service=git-upload-pack
POST /git/index/git-upload-pack
GET  /git/index/info/refs?service=git-receive-pack
POST /git/index/git-receive-pack
```

### Protocol Flow

1. **Capability Advertisement** (`info/refs`)
   - Server advertises refs and capabilities
   - Client determines what it needs

2. **Pack Negotiation** (`git-upload-pack`)
   - Client sends "wants" and "haves"
   - Server computes minimal packfile
   - Server streams packfile response

3. **Push Support** (`git-receive-pack`)
   - Client sends packfile with new objects
   - Server validates and applies changes
   - Triggers post-receive hooks for indexing

### Implementation Options

1. **Shell out to git-http-backend**
   - Pros: Full compatibility, battle-tested
   - Cons: Requires git installation, subprocess overhead

2. **Pure TypeScript implementation**
   - Pros: No external dependencies, full control
   - Cons: Complex to implement correctly, potential edge cases

3. **Hybrid approach**
   - Use git CLI for pack operations
   - Custom TypeScript for protocol handling
   - Best balance of reliability and control

### Recommended Approach

Start with option 1 (shell to git-http-backend) for correctness, then optimize hot paths in TypeScript if needed.

## Benefits

- **For Package Authors**: Publish packages via standard git push
- **For Mirror Operators**: Efficient incremental sync
- **For CI/CD**: Better integration with git workflows
- **For Enterprise**: Authentication and authorization hooks

## Security Considerations

- Validate all refs before accepting pushes
- Implement rate limiting for pack operations
- Support TLS termination at reverse proxy
- Consider signed commits for package integrity

## Timeline

- **v1.0**: Ship with Dumb HTTP (current implementation)
- **v1.1**: Add Smart HTTP read support (upload-pack)
- **v2.0**: Add Smart HTTP write support (receive-pack)

## Success Metrics

- Clone time reduction: >50% for incremental updates
- Successful push operations from moon CLI
- No increase in server resource usage

## Open Questions

1. Should we support git protocol v2 from the start?
2. How to handle authentication for push operations?
3. Should we implement shallow clone support?

## References

- [Git HTTP Transfer Protocols](https://git-scm.com/docs/http-protocol)
- [Git Pack Protocol](https://git-scm.com/docs/pack-protocol)
- [git-http-backend Documentation](https://git-scm.com/docs/git-http-backend)
