import { generateOpenAPISpec } from "../OpenAPI/GenerateSpec";
import path from "path";
import GeneratorConfig from "./GeneratorConfig";
import { ToolInstaller } from "./InstallTools";
import ProviderCodeSpecGenerator from "./ProviderCodeSpecGenerator";
import FrameworkGenerator from "./FrameworkGenerator";
import { GoModuleSetup } from "./GoModuleSetup";
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

    // Step 2: Generate  GeneratorConfig
    // eslint-disable-next-line no-console
    console.log("\n📄 Step 2: Generating GeneratorConfig...");
    GeneratorConfig.generateGeneratorConfigAndWriteToFile({
      openApiSpecInJsonFilePath: openApiSpecPath,
      outputPath: path.resolve(__dirname, "../../Terraform"),
      outputFileName: "generator-config.yml",
      providerName: "oneuptime",
    });

    // eslint-disable-next-line no-console
    console.log("GeneratorConfig generated successfully!");

    // Step 3: Install necessary tools
    // eslint-disable-next-line no-console
    // console.log("\n🔧 Step 3: Installing necessary tools...")
    await ToolInstaller.installTerraformPluginCodegenOpenAPI();
    await ToolInstaller.installTerraformPluginFrameworkGenerator();

    // eslint-disable-next-line no-console
    console.log("All necessary tools installed successfully!");

    // Step 4: Generate Terraform provider code spec
    ProviderCodeSpecGenerator.generateProviderCodeSpec({
      openApiFilePath: openApiSpecPath,
      outputPath: path.resolve(
        __dirname,
        "../../Terraform/ProviderCodeSpec.json"
      ),
      generatorConfigFilePath: path.resolve(
        __dirname,
        "../../Terraform/generator-config.yml"
      ),
    });

    // eslint-disable-next-line no-console
    console.log("Provider code specification generated successfully!");
    // Step 4: Generate Terraform provider code
    FrameworkGenerator.generateAll({
      specificationPath: path.resolve(
        __dirname,
        "../../Terraform/ProviderCodeSpec.json"
      ),
      outputPath: path.resolve(
        __dirname,
        "../../Terraform/terraform-provider-oneuptime/internal/provider"
      ),
      packageName: "oneuptime",
    });

    // Step 5: Init go module.
    GoModuleSetup.initGoModule({
      packageName: "oneuptime",
      path: path.resolve(
        __dirname,
        "../../Terraform/terraform-provider-oneuptime"
      ),
    });
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
