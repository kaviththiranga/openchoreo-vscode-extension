---
name: OpenChoreo resources
description: How to read and write OpenChoreo resource YAML (apiVersion openchoreo.dev/v1alpha1) in this workspace.
applyTo: "**/*.{yaml,yml}"
---

- Files with `apiVersion: openchoreo.dev/v1alpha1` are OpenChoreo resources. The fields each kind accepts depend on the connected control plane's version, so look them up with the `openchoreo-cp` MCP tools (the `get_*_schema` tools, for example `get_workload_schema` or `get_component_type_schema`) rather than guessing.
- Refer to platform resources (component types, traits, workflows, environments, deployment pipelines) only by names that exist on the platform. List them through the MCP tools first.
- The OpenChoreo extension validates these files as you edit them. Fix every OpenChoreo diagnostic in the file before applying it or creating the resource through MCP.
- A resource's `metadata.namespace` is the OpenChoreo namespace, not a Kubernetes namespace. Keep it equal to the namespace the user is working in unless they say otherwise.
- Ask before deleting resources, undeploying, or promoting to a production environment.
