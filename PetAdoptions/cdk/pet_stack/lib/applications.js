"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Applications = void 0;
const iam = require("aws-cdk-lib/aws-iam");
const ssm = require("aws-cdk-lib/aws-ssm");
const eks = require("aws-cdk-lib/aws-eks");
const resourcegroups = require("aws-cdk-lib/aws-resourcegroups");
const aws_ecr_assets_1 = require("aws-cdk-lib/aws-ecr-assets");
const yaml = require("js-yaml");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const fs_1 = require("fs");
const container_image_builder_1 = require("./common/container-image-builder");
const pet_adoptions_history_application_1 = require("./applications/pet-adoptions-history-application");
const lambda_layer_kubectl_v31_1 = require("@aws-cdk/lambda-layer-kubectl-v31");
class Applications extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const stackName = id;
        const roleArn = ssm.StringParameter.fromStringParameterAttributes(this, 'getParamClusterAdmin', { parameterName: "/eks/petsite/EKSMasterRoleArn" }).stringValue;
        const targetGroupArn = ssm.StringParameter.fromStringParameterAttributes(this, 'getParamTargetGroupArn', { parameterName: "/eks/petsite/TargetGroupArn" }).stringValue;
        const oidcProviderUrl = ssm.StringParameter.fromStringParameterAttributes(this, 'getOIDCProviderUrl', { parameterName: "/eks/petsite/OIDCProviderUrl" }).stringValue;
        const oidcProviderArn = ssm.StringParameter.fromStringParameterAttributes(this, 'getOIDCProviderArn', { parameterName: "/eks/petsite/OIDCProviderArn" }).stringValue;
        const rdsSecretArn = ssm.StringParameter.fromStringParameterAttributes(this, 'getRdsSecretArn', { parameterName: "/petstore/rdssecretarn" }).stringValue;
        const petHistoryTargetGroupArn = ssm.StringParameter.fromStringParameterAttributes(this, 'getPetHistoryParamTargetGroupArn', { parameterName: "/eks/pethistory/TargetGroupArn" }).stringValue;
        const cluster = eks.Cluster.fromClusterAttributes(this, 'MyCluster', {
            clusterName: 'PetSite',
            kubectlLayer: new lambda_layer_kubectl_v31_1.KubectlV31Layer(this, 'kubectl'),
            kubectlRoleArn: roleArn,
        });
        // ClusterID is not available for creating the proper conditions https://github.com/aws/aws-cdk/issues/10347
        // Thsos might be an issue
        const clusterId = aws_cdk_lib_1.Fn.select(4, aws_cdk_lib_1.Fn.split('/', oidcProviderUrl)); // Remove https:// from the URL as workaround to get ClusterID
        const stack = aws_cdk_lib_1.Stack.of(this);
        const region = stack.region;
        const app_federatedPrincipal = new iam.FederatedPrincipal(oidcProviderArn, {
            StringEquals: new aws_cdk_lib_1.CfnJson(this, "App_FederatedPrincipalCondition", {
                value: {
                    [`oidc.eks.${region}.amazonaws.com/id/${clusterId}:aud`]: "sts.amazonaws.com"
                }
            })
        });
        const app_trustRelationship = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [app_federatedPrincipal],
            actions: ["sts:AssumeRoleWithWebIdentity"]
        });
        // FrontEnd SA (SSM, SQS, SNS)
        const petstoreserviceaccount = new iam.Role(this, 'PetSiteServiceAccount', {
            //                assumedBy: eksFederatedPrincipal,
            assumedBy: new iam.AccountRootPrincipal(),
            managedPolicies: [
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetSiteServiceAccount-AmazonSSMFullAccess', 'arn:aws:iam::aws:policy/AmazonSSMFullAccess'),
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetSiteServiceAccount-AmazonSQSFullAccess', 'arn:aws:iam::aws:policy/AmazonSQSFullAccess'),
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetSiteServiceAccount-AmazonSNSFullAccess', 'arn:aws:iam::aws:policy/AmazonSNSFullAccess'),
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetSiteServiceAccount-AWSXRayDaemonWriteAccess', 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess')
            ],
        });
        petstoreserviceaccount.assumeRolePolicy?.addStatements(app_trustRelationship);
        const startStepFnExecutionPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'states:StartExecution'
            ],
            resources: ['*']
        });
        petstoreserviceaccount.addToPrincipalPolicy(startStepFnExecutionPolicy);
        const petsiteAsset = new aws_ecr_assets_1.DockerImageAsset(this, 'petsiteAsset', {
            directory: "./resources/microservices/petsite/petsite/"
        });
        var manifest = (0, fs_1.readFileSync)("./resources/k8s_petsite/deployment.yaml", "utf8");
        var deploymentYaml = yaml.loadAll(manifest);
        deploymentYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new aws_cdk_lib_1.CfnJson(this, "deployment_Role", { value: `${petstoreserviceaccount.roleArn}` });
        deploymentYaml[2].spec.template.spec.containers[0].image = new aws_cdk_lib_1.CfnJson(this, "deployment_Image", { value: `${petsiteAsset.imageUri}` });
        deploymentYaml[3].spec.targetGroupARN = new aws_cdk_lib_1.CfnJson(this, "targetgroupArn", { value: `${targetGroupArn}` });
        const deploymentManifest = new eks.KubernetesManifest(this, "petsitedeployment", {
            cluster: cluster,
            manifest: deploymentYaml
        });
        // PetAdoptionsHistory application definitions-----------------------------------------------------------------------
        const petAdoptionsHistoryContainerImage = new container_image_builder_1.ContainerImageBuilder(this, 'pet-adoptions-history-container-image', {
            repositoryName: "pet-adoptions-history",
            dockerImageAssetDirectory: "./resources/microservices/petadoptionshistory-py",
        });
        new ssm.StringParameter(this, "putPetAdoptionHistoryRepositoryName", {
            stringValue: petAdoptionsHistoryContainerImage.repositoryUri,
            parameterName: '/petstore/pethistoryrepositoryuri'
        });
        const petAdoptionsHistoryApplication = new pet_adoptions_history_application_1.PetAdoptionsHistory(this, 'pet-adoptions-history-application', {
            cluster: cluster,
            app_trustRelationship: app_trustRelationship,
            kubernetesManifestPath: "./resources/microservices/petadoptionshistory-py/deployment.yaml",
            otelConfigMapPath: "./resources/microservices/petadoptionshistory-py/otel-collector-config.yaml",
            rdsSecretArn: rdsSecretArn,
            region: region,
            imageUri: petAdoptionsHistoryContainerImage.imageUri,
            targetGroupArn: petHistoryTargetGroupArn
        });
        this.createSsmParameters(new Map(Object.entries({
            '/eks/petsite/stackname': stackName
        })));
        this.createOuputs(new Map(Object.entries({
            'PetSiteECRImageURL': petsiteAsset.imageUri,
            'PetStoreServiceAccountArn': petstoreserviceaccount.roleArn,
        })));
        // Creating AWS Resource Group for all the resources of stack.
        const applicationsCfnGroup = new resourcegroups.CfnGroup(this, 'ApplicationsCfnGroup', {
            name: stackName,
            description: 'Contains all the resources deployed by Cloudformation Stack ' + stackName,
            resourceQuery: {
                type: 'CLOUDFORMATION_STACK_1_0',
            }
        });
    }
    createSsmParameters(params) {
        params.forEach((value, key) => {
            //const id = key.replace('/', '_');
            new ssm.StringParameter(this, key, { parameterName: key, stringValue: value });
        });
    }
    createOuputs(params) {
        params.forEach((value, key) => {
            new aws_cdk_lib_1.CfnOutput(this, key, { value: value });
        });
    }
}
exports.Applications = Applications;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb25zLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwbGljYXRpb25zLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLGlFQUFpRTtBQUNqRSwrREFBOEQ7QUFDOUQsZ0NBQWdDO0FBQ2hDLDZDQUF3RTtBQUN4RSwyQkFBa0M7QUFFbEMsOEVBQW9HO0FBQ3BHLHdHQUFzRjtBQUN0RixnRkFBb0U7QUFFcEUsTUFBYSxZQUFhLFNBQVEsbUJBQUs7SUFDckMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFrQjtRQUMxRCxLQUFLLENBQUMsS0FBSyxFQUFDLEVBQUUsRUFBQyxLQUFLLENBQUMsQ0FBQztRQUV0QixNQUFNLFNBQVMsR0FBRyxFQUFFLENBQUM7UUFFckIsTUFBTSxPQUFPLEdBQUcsR0FBRyxDQUFDLGVBQWUsQ0FBQyw2QkFBNkIsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUUsRUFBRSxhQUFhLEVBQUUsK0JBQStCLEVBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQztRQUMvSixNQUFNLGNBQWMsR0FBRyxHQUFHLENBQUMsZUFBZSxDQUFDLDZCQUE2QixDQUFDLElBQUksRUFBRSx3QkFBd0IsRUFBRSxFQUFFLGFBQWEsRUFBRSw2QkFBNkIsRUFBQyxDQUFDLENBQUMsV0FBVyxDQUFDO1FBQ3RLLE1BQU0sZUFBZSxHQUFHLEdBQUcsQ0FBQyxlQUFlLENBQUMsNkJBQTZCLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFLEVBQUUsYUFBYSxFQUFFLDhCQUE4QixFQUFDLENBQUMsQ0FBQyxXQUFXLENBQUM7UUFDcEssTUFBTSxlQUFlLEdBQUcsR0FBRyxDQUFDLGVBQWUsQ0FBQyw2QkFBNkIsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUUsRUFBRSxhQUFhLEVBQUUsOEJBQThCLEVBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQztRQUNwSyxNQUFNLFlB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QUFDO0lBQ0wsQ0FBQztJQUVPLG1CQUFtQixDQUFDLE1BQTJCO1FBQ3JELE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLEVBQUUsR0FBRyxFQUFFLEVBQUU7WUFDMUIsbUNBQW1DO1lBQ25DLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFLEVBQUUsYUFBYSxFQUFFLEdBQUcsRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztRQUNuRixDQUFDLENBQUMsQ0FBQztJQUNILENBQUM7SUFFTyxZQUFZLENBQUMsTUFBMkI7UUFDaEQsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsRUFBRTtZQUMxQixJQUFJLHVCQUFTLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBQzlDLENBQUMsQ0FBQyxDQUFDO0lBQ0gsQ0FBQztDQUNKO0FBcklELG9DQXFJQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgc3NtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zc20nO1xyXG5pbXBvcnQgKiBhcyBla3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVrcyc7XHJcbmltcG9ydCAqIGFzIHJlc291cmNlZ3JvdXBzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yZXNvdXJjZWdyb3Vwcyc7XHJcbmltcG9ydCB7IERvY2tlckltYWdlQXNzZXQgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyLWFzc2V0cyc7XHJcbmltcG9ydCAqIGFzIHlhbWwgZnJvbSAnanMteWFtbCc7XHJcbmltcG9ydCB7IFN0YWNrLCBTdGFja1Byb3BzLCBDZm5Kc29uLCBGbiwgQ2ZuT3V0cHV0IH0gZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgeyByZWFkRmlsZVN5bmMgfSBmcm9tICdmcyc7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnXHJcbmltcG9ydCB7IENvbnRhaW5lckltYWdlQnVpbGRlclByb3BzLCBDb250YWluZXJJbWFnZUJ1aWxkZXIgfSBmcm9tICcuL2NvbW1vbi9jb250YWluZXItaW1hZ2UtYnVpbGRlcidcclxuaW1wb3J0IHsgUGV0QWRvcHRpb25zSGlzdG9yeSB9IGZyb20gJy4vYXBwbGljYXRpb25zL3BldC1hZG9wdGlvbnMtaGlzdG9yeS1hcHBsaWNhdGlvbidcclxuaW1wb3J0IHsgS3ViZWN0bFYzMUxheWVyIH0gZnJvbSAnQGF3cy1jZGsvbGFtYmRhLWxheWVyLWt1YmVjdGwtdjMxJztcclxuXHJcbmV4cG9ydCBjbGFzcyBBcHBsaWNhdGlvbnMgZXh0ZW5kcyBTdGFjayB7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBTdGFja1Byb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSxpZCxwcm9wcyk7XHJcblxyXG4gICAgY29uc3Qgc3RhY2tOYW1lID0gaWQ7XHJcblxyXG4gICAgY29uc3Qgcm9sZUFybiA9IHNzbS5TdHJpbmdQYXJhbWV0ZXIuZnJvbVN0cmluZ1BhcmFtZXRlckF0dHJpYnV0ZXModGhpcywgJ2dldFBhcmFtQ2x1c3RlckFkbWluJywgeyBwYXJhbWV0ZXJOYW1lOiBcIi9la3MvcGV0c2l0ZS9FS1NNYXN0ZXJSb2xlQXJuXCJ9KS5zdHJpbmdWYWx1ZTtcclxuICAgIGNvbnN0IHRhcmdldEdyb3VwQXJuID0gc3NtLlN0cmluZ1BhcmFtZXRlci5mcm9tU3RyaW5nUGFyYW1ldGVyQXR0cmlidXRlcyh0aGlzLCAnZ2V0UGFyYW1UYXJnZXRHcm91cEFybicsIHsgcGFyYW1ldGVyTmFtZTogXCIvZWtzL3BldHNpdGUvVGFyZ2V0R3JvdXBBcm5cIn0pLnN0cmluZ1ZhbHVlO1xyXG4gICAgY29uc3Qgb2lkY1Byb3ZpZGVyVXJsID0gc3NtLlN0cmluZ1BhcmFtZXRlci5mcm9tU3RyaW5nUGFyYW1ldGVyQXR0cmlidXRlcyh0aGlzLCAnZ2V0T0lEQ1Byb3ZpZGVyVXJsJywgeyBwYXJhbWV0ZXJOYW1lOiBcIi9la3MvcGV0c2l0ZS9PSURDUHJvdmlkZXJVcmxcIn0pLnN0cmluZ1ZhbHVlO1xyXG4gICAgY29uc3Qgb2lkY1Byb3ZpZGVyQXJuID0gc3NtLlN0cmluZ1BhcmFtZXRlci5mcm9tU3RyaW5nUGFyYW1ldGVyQXR0cmlidXRlcyh0aGlzLCAnZ2V0T0lEQ1Byb3ZpZGVyQXJuJywgeyBwYXJhbWV0ZXJOYW1lOiBcIi9la3MvcGV0c2l0ZS9PSURDUHJvdmlkZXJBcm5cIn0pLnN0cmluZ1ZhbHVlO1xyXG4gICAgY29uc3QgcmRzU2VjcmV0QXJuID0gc3NtLlN0cmluZ1BhcmFtZXRlci5mcm9tU3RyaW5nUGFyYW1ldGVyQXR0cmlidXRlcyh0aGlzLCAnZ2V0UmRzU2VjcmV0QXJuJywgeyBwYXJhbWV0ZXJOYW1lOiBcIi9wZXRzdG9yZS9yZHNzZWNyZXRhcm5cIn0pLnN0cmluZ1ZhbHVlO1xyXG4gICAgY29uc3QgcGV0SGlzdG9yeVRhcmdldEdyb3VwQXJuID0gc3NtLlN0cmluZ1BhcmFtZXRlci5mcm9tU3RyaW5nUGFyYW1ldGVyQXR0cmlidXRlcyh0aGlzLCAnZ2V0UGV0SGlzdG9yeVBhcmFtVGFyZ2V0R3JvdXBBcm4nLCB7IHBhcmFtZXRlck5hbWU6IFwiL2Vrcy9wZXRoaXN0b3J5L1RhcmdldEdyb3VwQXJuXCJ9KS5zdHJpbmdWYWx1ZTtcclxuXHJcbiAgICBjb25zdCBjbHVzdGVyID0gZWtzLkNsdXN0ZXIuZnJvbUNsdXN0ZXJBdHRyaWJ1dGVzKHRoaXMsICdNeUNsdXN0ZXInLCB7XHJcbiAgICAgIGNsdXN0ZXJOYW1lOiAnUGV0U2l0ZScsXHJcbiAgICAgIGt1YmVjdGxMYXllcjogbmV3IEt1YmVjdGxWMzFMYXllcih0aGlzLCAna3ViZWN0bCcpLFxyXG4gICAgICBrdWJlY3RsUm9sZUFybjogcm9sZUFybixcclxuICAgIH0pO1xyXG4gICAgLy8gQ2x1c3RlcklEIGlzIG5vdCBhdmFpbGFibGUgZm9yIGNyZWF0aW5nIHRoZSBwcm9wZXIgY29uZGl0aW9ucyBodHRwczovL2dpdGh1Yi5jb20vYXdzL2F3cy1jZGsvaXNzdWVzLzEwMzQ3XHJcbiAgICAvLyBUaHNvcyBtaWdodCBiZSBhbiBpc3N1ZVxyXG4gICAgY29uc3QgY2x1c3RlcklkID0gRm4uc2VsZWN0KDQsIEZuLnNwbGl0KCcvJywgb2lkY1Byb3ZpZGVyVXJsKSkgLy8gUmVtb3ZlIGh0dHBzOi8vIGZyb20gdGhlIFVSTCBhcyB3b3JrYXJvdW5kIHRvIGdldCBDbHVzdGVySURcclxuXHJcbiAgICBjb25zdCBzdGFjayA9IFN0YWNrLm9mKHRoaXMpO1xyXG4gICAgY29uc3QgcmVnaW9uID0gc3RhY2sucmVnaW9uO1xyXG5cclxuICAgIGNvbnN0IGFwcF9mZWRlcmF0ZWRQcmluY2lwYWwgPSBuZXcgaWFtLkZlZGVyYXRlZFByaW5jaXBhbChcclxuICAgICAgICBvaWRjUHJvdmlkZXJBcm4sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICBTdHJpbmdFcXVhbHM6IG5ldyBDZm5Kc29uKHRoaXMsIFwiQXBwX0ZlZGVyYXRlZFByaW5jaXBhbENvbmRpdGlvblwiLCB7XHJcbiAgICAgICAgICAgICAgICB2YWx1ZToge1xyXG4gICAgICAgICAgICAgICAgICAgIFtgb2lkYy5la3MuJHtyZWdpb259LmFtYXpvbmF3cy5jb20vaWQvJHtjbHVzdGVySWR9OmF1ZGAgXTogXCJzdHMuYW1hem9uYXdzLmNvbVwiXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgfVxyXG4gICAgKTtcclxuICAgIGNvbnN0IGFwcF90cnVzdFJlbGF0aW9uc2hpcCA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgcHJpbmNpcGFsczogWyBhcHBfZmVkZXJhdGVkUHJpbmNpcGFsIF0sXHJcbiAgICAgICAgYWN0aW9uczogW1wic3RzOkFzc3VtZVJvbGVXaXRoV2ViSWRlbnRpdHlcIl1cclxuICAgIH0pXHJcblxyXG5cclxuICAgIC8vIEZyb250RW5kIFNBIChTU00sIFNRUywgU05TKVxyXG4gICAgY29uc3QgcGV0c3RvcmVzZXJ2aWNlYWNjb3VudCA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnUGV0U2l0ZVNlcnZpY2VBY2NvdW50Jywge1xyXG4vLyAgICAgICAgICAgICAgICBhc3N1bWVkQnk6IGVrc0ZlZGVyYXRlZFByaW5jaXBhbCxcclxuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkFjY291bnRSb290UHJpbmNpcGFsKCksXHJcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21NYW5hZ2VkUG9saWN5QXJuKHRoaXMsICdQZXRTaXRlU2VydmljZUFjY291bnQtQW1hem9uU1NNRnVsbEFjY2VzcycsICdhcm46YXdzOmlhbTo6YXdzOnBvbGljeS9BbWF6b25TU01GdWxsQWNjZXNzJyksXHJcbiAgICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21NYW5hZ2VkUG9saWN5QXJuKHRoaXMsICdQZXRTaXRlU2VydmljZUFjY291bnQtQW1hem9uU1FTRnVsbEFjY2VzcycsICdhcm46YXdzOmlhbTo6YXdzOnBvbGljeS9BbWF6b25TUVNGdWxsQWNjZXNzJyksXHJcbiAgICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21NYW5hZ2VkUG9saWN5QXJuKHRoaXMsICdQZXRTaXRlU2VydmljZUFjY291bnQtQW1hem9uU05TRnVsbEFjY2VzcycsICdhcm46YXdzOmlhbTo6YXdzOnBvbGljeS9BbWF6b25TTlNGdWxsQWNjZXNzJyksXHJcbiAgICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21NYW5hZ2VkUG9saWN5QXJuKHRoaXMsICdQZXRTaXRlU2VydmljZUFjY291bnQtQVdTWFJheURhZW1vbldyaXRlQWNjZXNzJywgJ2Fybjphd3M6aWFtOjphd3M6cG9saWN5L0FXU1hSYXlEYWVtb25Xcml0ZUFjY2VzcycpXHJcbiAgICAgICAgXSxcclxuICAgIH0pO1xyXG4gICAgcGV0c3RvcmVzZXJ2aWNlYWNjb3VudC5hc3N1bWVSb2xlUG9saWN5Py5hZGRTdGF0ZW1lbnRzKGFwcF90cnVzdFJlbGF0aW9uc2hpcCk7XHJcblxyXG4gICAgY29uc3Qgc3RhcnRTdGVwRm5FeGVjdXRpb25Qb2xpY3kgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgJ3N0YXRlczpTdGFydEV4ZWN1dGlvbidcclxuICAgICAgICBdLFxyXG4gICAgICAgIHJlc291cmNlczogWycqJ11cclxuICAgICAgICB9KTtcclxuXHJcbiAgICBwZXRzdG9yZXNlcnZpY2VhY2NvdW50LmFkZFRvUHJpbmNpcGFsUG9saWN5KHN0YXJ0U3RlcEZuRXhlY3V0aW9uUG9saWN5KTtcclxuXHJcbiAgICBjb25zdCBwZXRzaXRlQXNzZXQgPSBuZXcgRG9ja2VySW1hZ2VBc3NldCh0aGlzLCAncGV0c2l0ZUFzc2V0Jywge1xyXG4gICAgICAgIGRpcmVjdG9yeTogXCIuL3Jlc291cmNlcy9taWNyb3NlcnZpY2VzL3BldHNpdGUvcGV0c2l0ZS9cIlxyXG4gICAgfSk7XHJcblxyXG5cclxuICAgIHZhciBtYW5pZmVzdCA9IHJlYWRGaWxlU3luYyhcIi4vcmVzb3VyY2VzL2s4c19wZXRzaXRlL2RlcGxveW1lbnQueWFtbFwiLFwidXRmOFwiKTtcclxuICAgIHZhciBkZXBsb3ltZW50WWFtbCA9IHlhbWwubG9hZEFsbChtYW5pZmVzdCkgYXMgUmVjb3JkPHN0cmluZyxhbnk+W107XHJcblxyXG4gICAgZGVwbG95bWVudFlhbWxbMF0ubWV0YWRhdGEuYW5ub3RhdGlvbnNbXCJla3MuYW1hem9uYXdzLmNvbS9yb2xlLWFyblwiXSA9IG5ldyBDZm5Kc29uKHRoaXMsIFwiZGVwbG95bWVudF9Sb2xlXCIsIHsgdmFsdWUgOiBgJHtwZXRzdG9yZXNlcnZpY2VhY2NvdW50LnJvbGVBcm59YCB9KTtcclxuICAgIGRlcGxveW1lbnRZYW1sWzJdLnNwZWMudGVtcGxhdGUuc3BlYy5jb250YWluZXJzWzBdLmltYWdlID0gbmV3IENmbkpzb24odGhpcywgXCJkZXBsb3ltZW50X0ltYWdlXCIsIHsgdmFsdWUgOiBgJHtwZXRzaXRlQXNzZXQuaW1hZ2VVcml9YCB9KTtcclxuICAgIGRlcGxveW1lbnRZYW1sWzNdLnNwZWMudGFyZ2V0R3JvdXBBUk4gPSBuZXcgQ2ZuSnNvbih0aGlzLFwidGFyZ2V0Z3JvdXBBcm5cIiwgeyB2YWx1ZTogYCR7dGFyZ2V0R3JvdXBBcm59YH0pXHJcblxyXG4gICAgY29uc3QgZGVwbG95bWVudE1hbmlmZXN0ID0gbmV3IGVrcy5LdWJlcm5ldGVzTWFuaWZlc3QodGhpcyxcInBldHNpdGVkZXBsb3ltZW50XCIse1xyXG4gICAgICAgIGNsdXN0ZXI6IGNsdXN0ZXIsXHJcbiAgICAgICAgbWFuaWZlc3Q6IGRlcGxveW1lbnRZYW1sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBQZXRBZG9wdGlvbnNIaXN0b3J5IGFwcGxpY2F0aW9uIGRlZmluaXRpb25zLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIGNvbnN0IHBldEFkb3B0aW9uc0hpc3RvcnlDb250YWluZXJJbWFnZSA9IG5ldyBDb250YWluZXJJbWFnZUJ1aWxkZXIodGhpcywgJ3BldC1hZG9wdGlvbnMtaGlzdG9yeS1jb250YWluZXItaW1hZ2UnLCB7XHJcbiAgICAgICByZXBvc2l0b3J5TmFtZTogXCJwZXQtYWRvcHRpb25zLWhpc3RvcnlcIixcclxuICAgICAgIGRvY2tlckltYWdlQXNzZXREaXJlY3Rvcnk6IFwiLi9yZXNvdXJjZXMvbWljcm9zZXJ2aWNlcy9wZXRhZG9wdGlvbnNoaXN0b3J5LXB5XCIsXHJcbiAgICB9KTtcclxuICAgIG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsXCJwdXRQZXRBZG9wdGlvbkhpc3RvcnlSZXBvc2l0b3J5TmFtZVwiLHtcclxuICAgICAgICBzdHJpbmdWYWx1ZTogcGV0QWRvcHRpb25zSGlzdG9yeUNvbnRhaW5lckltYWdlLnJlcG9zaXRvcnlVcmksXHJcbiAgICAgICAgcGFyYW1ldGVyTmFtZTogJy9wZXRzdG9yZS9wZXRoaXN0b3J5cmVwb3NpdG9yeXVyaSdcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHBldEFkb3B0aW9uc0hpc3RvcnlBcHBsaWNhdGlvbiA9IG5ldyBQZXRBZG9wdGlvbnNIaXN0b3J5KHRoaXMsICdwZXQtYWRvcHRpb25zLWhpc3RvcnktYXBwbGljYXRpb24nLCB7XHJcbiAgICAgICAgY2x1c3RlcjogY2x1c3RlcixcclxuICAgICAgICBhcHBfdHJ1c3RSZWxhdGlvbnNoaXA6IGFwcF90cnVzdFJlbGF0aW9uc2hpcCxcclxuICAgICAgICBrdWJlcm5ldGVzTWFuaWZlc3RQYXRoOiBcIi4vcmVzb3VyY2VzL21pY3Jvc2VydmljZXMvcGV0YWRvcHRpb25zaGlzdG9yeS1weS9kZXBsb3ltZW50LnlhbWxcIixcclxuICAgICAgICBvdGVsQ29uZmlnTWFwUGF0aDogXCIuL3Jlc291cmNlcy9taWNyb3NlcnZpY2VzL3BldGFkb3B0aW9uc2hpc3RvcnktcHkvb3RlbC1jb2xsZWN0b3ItY29uZmlnLnlhbWxcIixcclxuICAgICAgICByZHNTZWNyZXRBcm46IHJkc1NlY3JldEFybixcclxuICAgICAgICByZWdpb246IHJlZ2lvbixcclxuICAgICAgICBpbWFnZVVyaTogcGV0QWRvcHRpb25zSGlzdG9yeUNvbnRhaW5lckltYWdlLmltYWdlVXJpLFxyXG4gICAgICAgIHRhcmdldEdyb3VwQXJuOiBwZXRIaXN0b3J5VGFyZ2V0R3JvdXBBcm5cclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuY3JlYXRlU3NtUGFyYW1ldGVycyhuZXcgTWFwKE9iamVjdC5lbnRyaWVzKHtcclxuICAgICAgICAnL2Vrcy9wZXRzaXRlL3N0YWNrbmFtZSc6IHN0YWNrTmFtZVxyXG4gICAgfSkpKTtcclxuXHJcbiAgICB0aGlzLmNyZWF0ZU91cHV0cyhuZXcgTWFwKE9iamVjdC5lbnRyaWVzKHtcclxuICAgICAgICAnUGV0U2l0ZUVDUkltYWdlVVJMJzogcGV0c2l0ZUFzc2V0LmltYWdlVXJpLFxyXG4gICAgICAgICdQZXRTdG9yZVNlcnZpY2VBY2NvdW50QXJuJzogcGV0c3RvcmVzZXJ2aWNlYWNjb3VudC5yb2xlQXJuLFxyXG4gICAgfSkpKTtcclxuICAgIC8vIENyZWF0aW5nIEFXUyBSZXNvdXJjZSBHcm91cCBmb3IgYWxsIHRoZSByZXNvdXJjZXMgb2Ygc3RhY2suXHJcbiAgICBjb25zdCBhcHBsaWNhdGlvbnNDZm5Hcm91cCA9IG5ldyByZXNvdXJjZWdyb3Vwcy5DZm5Hcm91cCh0aGlzLCAnQXBwbGljYXRpb25zQ2ZuR3JvdXAnLCB7XHJcbiAgICAgICAgbmFtZTogc3RhY2tOYW1lLFxyXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnQ29udGFpbnMgYWxsIHRoZSByZXNvdXJjZXMgZGVwbG95ZWQgYnkgQ2xvdWRmb3JtYXRpb24gU3RhY2sgJyArIHN0YWNrTmFtZSxcclxuICAgICAgICByZXNvdXJjZVF1ZXJ5OiB7XHJcbiAgICAgICAgICB0eXBlOiAnQ0xPVURGT1JNQVRJT05fU1RBQ0tfMV8wJyxcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlU3NtUGFyYW1ldGVycyhwYXJhbXM6IE1hcDxzdHJpbmcsIHN0cmluZz4pIHtcclxuICAgIHBhcmFtcy5mb3JFYWNoKCh2YWx1ZSwga2V5KSA9PiB7XHJcbiAgICAgICAgLy9jb25zdCBpZCA9IGtleS5yZXBsYWNlKCcvJywgJ18nKTtcclxuICAgICAgICBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCBrZXksIHsgcGFyYW1ldGVyTmFtZToga2V5LCBzdHJpbmdWYWx1ZTogdmFsdWUgfSk7XHJcbiAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGNyZWF0ZU91cHV0cyhwYXJhbXM6IE1hcDxzdHJpbmcsIHN0cmluZz4pIHtcclxuICAgIHBhcmFtcy5mb3JFYWNoKCh2YWx1ZSwga2V5KSA9PiB7XHJcbiAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLCBrZXksIHsgdmFsdWU6IHZhbHVlIH0pXHJcbiAgICB9KTtcclxuICAgIH1cclxufSJdfQ==