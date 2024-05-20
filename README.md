## Local Development Setup
Very much a work in progress. Uses OAUTH0 for user authentication.

### Prerequisites

- Node.js
- `mkcert` for creating local SSL certificates

### Setting Up Local SSL Certificates

1. **Install `mkcert`**:

   Follow the instructions on the [mkcert GitHub page](https://github.com/FiloSottile/mkcert) to install `mkcert`.

2. **Generate Certificates**:

   Open a terminal, navigate to the project directory, and run the following commands:

   ```bash
   mkcert -install
   mkcert localhost
