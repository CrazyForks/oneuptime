// TODO: Build terraform provider from openapi spec. 

import { generateOpenAPISpec } from "../OpenAPI/GenerateSpec";
import path from "path";
import fs from "fs";

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("🚀 Starting Terraform Provider Generation Process...");

  // remove existing Terraform directory if it exists
  const terraformDir = path.resolve(__dirname, "../../Terraform");
  if (fs.existsSync(terraformDir)) {
    // eslint-disable-next-line no-console
    console.log("🗑️ Removing existing Terraform directory...");
    fs.rmSync(terraformDir, { recursive: true, force: true });
  }

  try {
    // 1. Generate OpenAPI spec
    // eslint-disable-next-line no-console
    console.log("\n📄 Step 1: Generating OpenAPI specification...");
    const openApiSpecPath: string = path.resolve(
      __dirname,
      "../../Terraform/openapi.json"
    );

    // Step 1: Generate OpenAPI specification
    //eslint-disable-next-line no-console
    console.log("Generating OpenAPI specification...");
    await generateOpenAPISpec(openApiSpecPath);

    // now that we have OPENAPI spec, we can generate the Terraform provider

    
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("❌ Error during Terraform provider generation:", error);
    throw new Error(
      `Failed to generate Terraform provider: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

main().catch((err: Error) => {
  // eslint-disable-next-line no-console
  console.error("💥 Unexpected error:", err);
  process.exit(1);
});
