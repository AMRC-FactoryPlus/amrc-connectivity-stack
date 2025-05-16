# ACS Admin Developer Guide

> The [AMRC Connectivity Stack (ACS)](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack) is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk).

This guide provides comprehensive documentation for developers working with the ACS Admin interface, which serves as the web-based management console for the AMRC Connectivity Stack.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Store System](#store-system)
5. [UI Components](#ui-components)
6. [Authentication & Authorization](#authentication--authorization)
7. [Factory+ Integration](#factory-integration)
8. [Adding New Features](#adding-new-features)
9. [Testing](#testing)
10. [Deployment](#deployment)

## Architecture Overview

ACS Admin is a Vue.js-based web application that provides a management interface for the AMRC Connectivity Stack. It communicates with various Factory+ services through the Factory+ service client libraries and provides a reactive UI that updates in real-time as changes occur in the system.

The application follows a component-based architecture with reactive stores for data management. It uses Vue Router for navigation and Pinia for state management.

### Key Architectural Concepts

- **Reactive Stores**: Data is managed through reactive stores that automatically update when the underlying Factory+ objects change
- **Component-Based UI**: The UI is built using reusable components
- **Service Integration**: The application integrates with Factory+ services through client libraries

## Technology Stack

ACS Admin is built using the following technologies:

- **Frontend Framework**: [Vue.js 3](https://vuejs.org/) with Composition API
- **Build Tool**: [Vite](https://vitejs.dev/) with [Bun](https://bun.sh/) as the JavaScript runtime
- **State Management**: [Pinia](https://pinia.vuejs.org/) with persistence support
- **Routing**: [Vue Router](https://router.vuejs.org/)
- **UI Components**: Custom components built with [Tailwind CSS](https://tailwindcss.com/) and [shadcn/ui](https://www.shadcn-vue.com/)
- **Reactive Programming**: [RxJS](https://rxjs.dev/) for reactive data handling
- **API Integration**: Custom Factory+ service client libraries

## Project Structure

The ACS Admin project follows a standard Vue.js project structure with some additional directories for Factory+ specific functionality:

```
acs-admin/
├── docs/                  # Documentation
├── public/                # Static assets
├── src/
│   ├── assets/            # CSS and other assets
│   ├── components/        # Reusable Vue components
│   │   ├── ui/            # UI component library
│   │   └── ...            # Feature-specific components
│   ├── lib/               # Utility functions
│   ├── pages/             # Page components
│   ├── store/             # Pinia stores and Factory+ stores
│   ├── App.vue            # Root component
│   └── main.js            # Application entry point
├── index.html             # HTML template
├── package.json           # Dependencies and scripts
└── tailwind.config.js     # Tailwind CSS configuration
```

## Store System

The store system is a core part of ACS Admin, providing reactive data management for Factory+ objects. It's built on top of Pinia and RxJS, with automatic binding resolution for related data.

### useStore Utility

The `useStore` utility creates reactive stores for Factory+ objects with automatic binding resolution. It supports both eager (immediate) and lazy (on-demand) binding of related data.

For detailed documentation on the store system, see [useStore](useStore.md).

### Key Store Concepts

- **Factory+ Objects**: Each store manages a collection of Factory+ objects of a specific class
- **Eager Binding**: Related data that is always loaded when the store starts
- **Lazy Binding**: Related data that is loaded on-demand when needed
- **Store Lifecycle**: Stores have start, stop, and synchronize methods to manage their lifecycle

### Available Stores

ACS Admin includes several pre-configured stores for common Factory+ objects:

- `useDeviceStore`: Manages Factory+ devices
- `useNodeStore`: Manages edge agent nodes
- `useConnectionStore`: Manages edge agent connections
- `useDriverStore`: Manages edge agent drivers
- `useClusterStore`: Manages edge clusters
- `useSchemaStore`: Manages schemas
- `useApplicationStore`: Manages applications
- `useObjectStore`: Base store for all Factory+ objects
- `useServiceClientStore`: Manages the Factory+ service client

## UI Components

ACS Admin uses a component-based UI architecture with a custom component library built on top of Tailwind CSS and shadcn/ui.

### Component Library

The component library is located in `src/components/ui/` and includes common UI components such as:

- Buttons, inputs, and form controls
- Cards and containers
- Dialogs and modals
- Navigation components
- Data tables and lists

### Using Components

Components can be imported and used in Vue components:

```vue
<script setup>
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Example Card</CardTitle>
    </CardHeader>
    <CardContent>
      <p>Card content goes here</p>
      <Button>Click Me</Button>
    </CardContent>
  </Card>
</template>
```

## Authentication & Authorization

ACS Admin uses the Factory+ authentication system for user authentication and authorization. The authentication flow is managed by the `useServiceClientStore`.

### Authentication Flow

1. User enters credentials on the login page
2. Credentials are passed to the Factory+ service client
3. If authentication is successful, the service client is stored in the `useServiceClientStore`
4. The user is redirected to the requested page
5. If authentication fails, an error is displayed

### Authorization

Authorization is handled by the Factory+ authentication service. The UI adapts based on the user's permissions, hiding or disabling features that the user doesn't have access to.

## Factory+ Integration

ACS Admin integrates with Factory+ services through the Factory+ service client libraries. The main integration points are:

### Service Client

The `useServiceClientStore` provides access to the Factory+ service client, which is used to communicate with Factory+ services:

```javascript
import { useServiceClientStore } from '@/store/serviceClientStore.js'

// In a component or store
const serviceClientStore = useServiceClientStore()
const client = serviceClientStore.client

// Example: Get a configuration from ConfigDB
const config = await client.ConfigDB.get_config(appUuid, objectUuid)
```

### Factory+ UUIDs

Factory+ uses UUIDs to identify objects, classes, and services. These UUIDs are defined in the `UUIDs` object from the service client library:

```javascript
import { UUIDs } from '@amrc-factoryplus/service-client'

// Example: Get the UUID for the Device class
const deviceClassUuid = UUIDs.Class.Device
```

## Adding New Features

When adding new features to ACS Admin, follow these guidelines:

### 1. Create a Store (if needed)

If your feature needs to manage Factory+ objects, create a store using the `useStore` utility:

```javascript
// src/store/useMyFeatureStore.js
import { UUIDs } from '@amrc-factoryplus/service-client'
import { useStore } from '@store/useStore.ts'

export const useMyFeatureStore = () => useStore(
  'my-feature',
  UUIDs.Class.MyFeatureClass,
  {
    // Eager bindings
    someBinding: UUIDs.App.SomeApp
  }
)()
```

### 2. Create Components

Create the necessary components for your feature:

```vue
<!-- src/components/MyFeature/MyFeatureComponent.vue -->
<script setup>
import { useMyFeatureStore } from '@/store/useMyFeatureStore.js'
import { storeReady } from '@/store/useStoreReady.js'
import { Button } from '@/components/ui/button'

const store = useMyFeatureStore()

// Wait for the store to be ready
await storeReady(store)
</script>

<template>
  <div>
    <h1>My Feature</h1>
    <ul>
      <li v-for="item in store.data" :key="item.uuid">
        {{ item.name }}
      </li>
    </ul>
    <Button @click="store.synchronise">Refresh</Button>
  </div>
</template>
```

### 3. Add Routes

Add routes for your feature in `src/main.js`:

```javascript
const routes = [
  // ... existing routes
  {
    path: '/my-feature',
    component: MyFeaturePage,
    meta: {
      name: 'My Feature',
      icon: 'feature-icon'
    }
  }
]
```

## Testing

ACS Admin doesn't currently have automated tests. Manual testing should be performed to ensure that new features work correctly.

## Deployment

ACS Admin is deployed as a Docker container as part of the ACS Helm chart. The build process is defined in the `Dockerfile` in the root of the project.

### Building for Development

First off, install the dependencies:

```sh
bun install
```

Then, run the development server:

```sh
bun dev
```

### Building for Production

To build the application for production:

```sh
bun build
```

This will create a production build in the `dist` directory, which can be served by any static file server.

### Docker Build

The Docker build process is defined in the `Dockerfile`:

1. Build the application using Bun
2. Copy the built files to an Nginx container
3. Configure Nginx to serve the application

## Further Reading

- [useStore Documentation](useStore.md)
- [Factory+ Framework Documentation](https://factoryplus.app.amrc.co.uk)
- [Vue.js Documentation](https://vuejs.org/)
- [Pinia Documentation](https://pinia.vuejs.org/)
- [Tailwind CSS Documentation](https://tailwindcss.com/)