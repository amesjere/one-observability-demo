"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PetAdoptionsHistory = void 0;
const iam = require("aws-cdk-lib/aws-iam");
const eks = require("aws-cdk-lib/aws-eks");
const yaml = require("js-yaml");
const eks_application_1 = require("./eks-application");
const fs_1 = require("fs");
class PetAdoptionsHistory extends eks_application_1.EksApplication {
    constructor(scope, id, props) {
        super(scope, id, props);
        const petadoptionhistoryserviceaccount = new iam.Role(this, 'PetSiteServiceAccount', {
            //        assumedBy: eksFederatedPrincipal,
            assumedBy: new iam.AccountRootPrincipal(),
            managedPolicies: [
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetAdoptionHistoryServiceAccount-AWSXRayDaemonWriteAccess', 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess'),
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetAdoptionHistoryServiceAccount-AmazonPrometheusRemoteWriteAccess', 'arn:aws:iam::aws:policy/AmazonPrometheusRemoteWriteAccess')
            ],
        });
        petadoptionhistoryserviceaccount.assumeRolePolicy?.addStatements(props.app_trustRelationship);
        const readSSMParamsPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "ssm:GetParametersByPath",
                "ssm:GetParameters",
                "ssm:GetParameter",
                "ec2:DescribeVpcs"
            ],
            resources: ['*']
        });
        petadoptionhistoryserviceaccount.addToPolicy(readSSMParamsPolicy);
        const ddbSeedPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "dynamodb:BatchWriteItem",
                "dynamodb:ListTables",
                "dynamodb:Scan",
                "dynamodb:Query"
            ],
            resources: ['*']
        });
        petadoptionhistoryserviceaccount.addToPolicy(ddbSeedPolicy);
        const rdsSecretPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "secretsmanager:GetSecretValue"
            ],
            resources: [props.rdsSecretArn]
        });
        petadoptionhistoryserviceaccount.addToPolicy(rdsSecretPolicy);
        const awsOtelPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "logs:PutLogEvents",
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:DescribeLogStreams",
                "logs:DescribeLogGroups",
                "xray:PutTraceSegments",
                "xray:PutTelemetryRecords",
                "xray:GetSamplingRules",
                "xray:GetSamplingTargets",
                "xray:GetSamplingStatisticSummaries",
                "ssm:GetParameters"
            ],
            resources: ['*']
        });
        petadoptionhistoryserviceaccount.addToPolicy(awsOtelPolicy);
        // otel collector config
        var otelConfigMapManifest = (0, fs_1.readFileSync)(props.otelConfigMapPath, "utf8");
        var otelConfigMapYaml = yaml.loadAll(otelConfigMapManifest);
        otelConfigMapYaml[0].data["otel-config.yaml"] = otelConfigMapYaml[0].data["otel-config.yaml"].replace(/{{AWS_REGION}}/g, props.region);
        const otelConfigDeploymentManifest = new eks.KubernetesManifest(this, "otelConfigDeployment", {
            cluster: props.cluster,
            manifest: otelConfigMapYaml
        });
        // deployment manifest
        var manifest = (0, fs_1.readFileSync)(props.kubernetesManifestPath, "utf8");
        var deploymentYaml = yaml.loadAll(manifest);
        deploymentYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = petadoptionhistoryserviceaccount.roleArn;
        deploymentYaml[2].spec.template.spec.containers[0].image = props.imageUri;
        deploymentYaml[2].spec.template.spec.containers[0].env[1].value = props.region;
        deploymentYaml[2].spec.template.spec.containers[0].env[3].value = `ClusterName=${props.cluster.clusterName}`;
        deploymentYaml[2].spec.template.spec.containers[0].env[5].value = props.region;
        deploymentYaml[2].spec.template.spec.containers[1].env[0].value = props.region;
        deploymentYaml[3].spec.targetGroupARN = props.targetGroupArn;
        const deploymentManifest = new eks.KubernetesManifest(this, "petsitedeployment", {
            cluster: props.cluster,
            manifest: deploymentYaml
        });
    }
}
exports.PetAdoptionsHistory = PetAdoptionsHistory;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGV0LWFkb3B0aW9ucy1oaXN0b3J5LWFwcGxpY2F0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicGV0LWFkb3B0aW9ucy1oaXN0b3J5LWFwcGxpY2F0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUEyQztBQUMzQywyQ0FBMkM7QUFHM0MsZ0NBQWdDO0FBRWhDLHVEQUF1RTtBQUN2RSwyQkFBa0M7QUFTbEMsTUFBYSxtQkFBb0IsU0FBUSxnQ0FBYztJQUVyRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQStCO1FBQ3ZFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sZ0NBQWdDLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUN6RiwyQ0FBMkM7WUFDbkMsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLG9CQUFvQixFQUFFO1lBQ3pDLGVBQWUsRUFBRTtnQkFDYixHQUFHLENBQUMsYUFBYSxDQUFDLG9CQUFvQixDQUFDLElBQUksRUFBRSwyREFBMkQsRUFBRSxrREFBa0QsQ0FBQztnQkFDN0osR0FBRyxDQUFDLGFBQWEsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUUsb0VBQW9FLEVBQUUsMkRBQTJELENBQUM7YUFDbEw7U0FDSixDQUFDLENBQUM7UUFDSCxnQ0FBZ0MsQ0FBQyxnQkFBZ0IsRUFBRSxhQUFhLENBQUMsS0FBSyxDQUFDLHFCQUFxQixDQUFDLENBQUM7UUFFOUYsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDaEQsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztZQUN4QixPQUFPLEVBQUU7Z0JBQ0wseUJBQXlCO2dCQUN6QixtQkFBbUI7Z0JBQ25CLGtCQUFrQjtnQkFDbEIsa0JBQWtCO2FBQ3JCO1lBQ0QsU0FBUyxFQUFFLENBQUMsR0FBRyxD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R0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDO1FBQy9FLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssR0FBRyxlQUFlLEtBQUssQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDN0csY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUM7UUFDL0UsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUM7UUFDL0UsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxjQUFjLEdBQUcsS0FBSyxDQUFDLGNBQWMsQ0FBQztRQUU3RCxNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxDQUFDLGtCQUFrQixDQUFDLElBQUksRUFBQyxtQkFBbUIsRUFBQztZQUMzRSxPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87WUFDdEIsUUFBUSxFQUFFLGNBQWM7U0FDM0IsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUVGO0FBL0ZELGtEQStGQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgZWtzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1la3MnO1xyXG5pbXBvcnQgKiBhcyByZHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXJkcyc7XHJcbmltcG9ydCAqIGFzIHNzbSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJztcclxuaW1wb3J0ICogYXMgeWFtbCBmcm9tICdqcy15YW1sJztcclxuaW1wb3J0IHsgQ2ZuSnNvbiB9IGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0IHsgRWtzQXBwbGljYXRpb24sIEVrc0FwcGxpY2F0aW9uUHJvcHMgfSBmcm9tICcuL2Vrcy1hcHBsaWNhdGlvbidcclxuaW1wb3J0IHsgcmVhZEZpbGVTeW5jIH0gZnJvbSAnZnMnO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJ1xyXG5cclxuZXhwb3J0IGludGVyZmFjZSBQZXRBZG9wdGlvbnNIaXN0b3J5UHJvcHMgZXh0ZW5kcyBFa3NBcHBsaWNhdGlvblByb3BzIHtcclxuICAgIHJkc1NlY3JldEFybjogICAgICBzdHJpbmcsXHJcbiAgICB0YXJnZXRHcm91cEFybjogICAgc3RyaW5nLFxyXG4gICAgb3RlbENvbmZpZ01hcFBhdGg6IHN0cmluZyxcclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIFBldEFkb3B0aW9uc0hpc3RvcnkgZXh0ZW5kcyBFa3NBcHBsaWNhdGlvbiB7XHJcblxyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBQZXRBZG9wdGlvbnNIaXN0b3J5UHJvcHMpIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xyXG5cclxuICAgIGNvbnN0IHBldGFkb3B0aW9uaGlzdG9yeXNlcnZpY2VhY2NvdW50ID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdQZXRTaXRlU2VydmljZUFjY291bnQnLCB7XHJcbi8vICAgICAgICBhc3N1bWVkQnk6IGVrc0ZlZGVyYXRlZFByaW5jaXBhbCxcclxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQWNjb3VudFJvb3RQcmluY2lwYWwoKSxcclxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcclxuICAgICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4odGhpcywgJ1BldEFkb3B0aW9uSGlzdG9yeVNlcnZpY2VBY2NvdW50LUFXU1hSYXlEYWVtb25Xcml0ZUFjY2VzcycsICdhcm46YXdzOmlhbTo6YXdzOnBvbGljeS9BV1NYUmF5RGFlbW9uV3JpdGVBY2Nlc3MnKSxcclxuICAgICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4odGhpcywgJ1BldEFkb3B0aW9uSGlzdG9yeVNlcnZpY2VBY2NvdW50LUFtYXpvblByb21ldGhldXNSZW1vdGVXcml0ZUFjY2VzcycsICdhcm46YXdzOmlhbTo6YXdzOnBvbGljeS9BbWF6b25Qcm9tZXRoZXVzUmVtb3RlV3JpdGVBY2Nlc3MnKVxyXG4gICAgICAgIF0sXHJcbiAgICB9KTtcclxuICAgIHBldGFkb3B0aW9uaGlzdG9yeXNlcnZpY2VhY2NvdW50LmFzc3VtZVJvbGVQb2xpY3k/LmFkZFN0YXRlbWVudHMocHJvcHMuYXBwX3RydXN0UmVsYXRpb25zaGlwKTtcclxuXHJcbiAgICBjb25zdCByZWFkU1NNUGFyYW1zUG9saWN5ID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgIFwic3NtOkdldFBhcmFtZXRlcnNCeVBhdGhcIixcclxuICAgICAgICAgICAgXCJzc206R2V0UGFyYW1ldGVyc1wiLFxyXG4gICAgICAgICAgICBcInNzbTpHZXRQYXJhbWV0ZXJcIixcclxuICAgICAgICAgICAgXCJlYzI6RGVzY3JpYmVWcGNzXCJcclxuICAgICAgICBdLFxyXG4gICAgICAgIHJlc291cmNlczogWycqJ11cclxuICAgIH0pO1xyXG4gICAgcGV0YWRvcHRpb25oaXN0b3J5c2VydmljZWFjY291bnQuYWRkVG9Qb2xpY3kocmVhZFNTTVBhcmFtc1BvbGljeSk7XHJcblxyXG4gICAgY29uc3QgZGRiU2VlZFBvbGljeSA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICBcImR5bmFtb2RiOkJhdGNoV3JpdGVJdGVtXCIsXHJcbiAgICAgICAgICAgIFwiZHluYW1vZGI6TGlzdFRhYmxlc1wiLFxyXG4gICAgICAgICAgICBcImR5bmFtb2RiOlNjYW5cIixcclxuICAgICAgICAgICAgXCJkeW5hbW9kYjpRdWVyeVwiXHJcbiAgICAgICAgXSxcclxuICAgICAgICByZXNvdXJjZXM6IFsnKiddXHJcbiAgICB9KTtcclxuICAgIHBldGFkb3B0aW9uaGlzdG9yeXNlcnZpY2VhY2NvdW50LmFkZFRvUG9saWN5KGRkYlNlZWRQb2xpY3kpO1xyXG5cclxuICAgIGNvbnN0IHJkc1NlY3JldFBvbGljeSA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICBcInNlY3JldHNtYW5hZ2VyOkdldFNlY3JldFZhbHVlXCJcclxuICAgICAgICBdLFxyXG4gICAgICAgIHJlc291cmNlczogW3Byb3BzLnJkc1NlY3JldEFybl1cclxuICAgIH0pO1xyXG4gICAgcGV0YWRvcHRpb25oaXN0b3J5c2VydmljZWFjY291bnQuYWRkVG9Qb2xpY3kocmRzU2VjcmV0UG9saWN5KTtcclxuXHJcbiAgICBjb25zdCBhd3NPdGVsUG9saWN5ID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICBhY3Rpb25zOiBbXHJcblx0XHRcdFwibG9nczpQdXRMb2dFdmVudHNcIixcclxuXHRcdFx0XCJsb2dzOkNyZWF0ZUxvZ0dyb3VwXCIsXHJcblx0XHRcdFwibG9nczpDcmVhdGVMb2dTdHJlYW1cIixcclxuXHRcdFx0XCJsb2dzOkRlc2NyaWJlTG9nU3RyZWFtc1wiLFxyXG5cdFx0XHRcImxvZ3M6RGVzY3JpYmVMb2dHcm91cHNcIixcclxuXHRcdFx0XCJ4cmF5OlB1dFRyYWNlU2VnbWVudHNcIixcclxuXHRcdFx0XCJ4cmF5OlB1dFRlbGVtZXRyeVJlY29yZHNcIixcclxuXHRcdFx0XCJ4cmF5OkdldFNhbXBsaW5nUnVsZXNcIixcclxuXHRcdFx0XCJ4cmF5OkdldFNhbXBsaW5nVGFyZ2V0c1wiLFxyXG5cdFx0XHRcInhyYXk6R2V0U2FtcGxpbmdTdGF0aXN0aWNTdW1tYXJpZXNcIixcclxuXHRcdFx0XCJzc206R2V0UGFyYW1ldGVyc1wiXHJcbiAgICAgICAgXSxcclxuICAgICAgICByZXNvdXJjZXM6IFsnKiddXHJcbiAgICB9KTtcclxuICAgIHBldGFkb3B0aW9uaGlzdG9yeXNlcnZpY2VhY2NvdW50LmFkZFRvUG9saWN5KGF3c090ZWxQb2xpY3kpO1xyXG5cclxuICAgIC8vIG90ZWwgY29sbGVjdG9yIGNvbmZpZ1xyXG4gICAgdmFyIG90ZWxDb25maWdNYXBNYW5pZmVzdCA9IHJlYWRGaWxlU3luYyhwcm9wcy5vdGVsQ29uZmlnTWFwUGF0aCxcInV0ZjhcIik7XHJcbiAgICB2YXIgb3RlbENvbmZpZ01hcFlhbWwgPSB5YW1sLmxvYWRBbGwob3RlbENvbmZpZ01hcE1hbmlmZXN0KSBhcyBSZWNvcmQ8c3RyaW5nLGFueT5bXTtcclxuICAgIG90ZWxDb25maWdNYXBZYW1sWzBdLmRhdGFbXCJvdGVsLWNvbmZpZy55YW1sXCJdID0gb3RlbENvbmZpZ01hcFlhbWxbMF0uZGF0YVtcIm90ZWwtY29uZmlnLnlhbWxcIl0ucmVwbGFjZSgve3tBV1NfUkVHSU9OfX0vZywgcHJvcHMucmVnaW9uKTtcclxuXHJcbiAgICBjb25zdCBvdGVsQ29uZmlnRGVwbG95bWVudE1hbmlmZXN0ID0gbmV3IGVrcy5LdWJlcm5ldGVzTWFuaWZlc3QodGhpcyxcIm90ZWxDb25maWdEZXBsb3ltZW50XCIse1xyXG4gICAgICAgIGNsdXN0ZXI6IHByb3BzLmNsdXN0ZXIsXHJcbiAgICAgICAgbWFuaWZlc3Q6IG90ZWxDb25maWdNYXBZYW1sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBkZXBsb3ltZW50IG1hbmlmZXN0XHJcbiAgICB2YXIgbWFuaWZlc3QgPSByZWFkRmlsZVN5bmMocHJvcHMua3ViZXJuZXRlc01hbmlmZXN0UGF0aCxcInV0ZjhcIik7XHJcbiAgICB2YXIgZGVwbG95bWVudFlhbWwgPSB5YW1sLmxvYWRBbGwobWFuaWZlc3QpIGFzIFJlY29yZDxzdHJpbmcsYW55PltdO1xyXG5cclxuICAgIGRlcGxveW1lbnRZYW1sWzBdLm1ldGFkYXRhLmFubm90YXRpb25zW1wiZWtzLmFtYXpvbmF3cy5jb20vcm9sZS1hcm5cIl0gPSBwZXRhZG9wdGlvbmhpc3RvcnlzZXJ2aWNlYWNjb3VudC5yb2xlQXJuO1xyXG4gICAgZGVwbG95bWVudFlhbWxbMl0uc3BlYy50ZW1wbGF0ZS5zcGVjLmNvbnRhaW5lcnNbMF0uaW1hZ2UgPSBwcm9wcy5pbWFnZVVyaTtcclxuICAgIGRlcGxveW1lbnRZYW1sWzJdLnNwZWMudGVtcGxhdGUuc3BlYy5jb250YWluZXJzWzBdLmVudlsxXS52YWx1ZSA9IHByb3BzLnJlZ2lvbjtcclxuICAgIGRlcGxveW1lbnRZYW1sWzJdLnNwZWMudGVtcGxhdGUuc3BlYy5jb250YWluZXJzWzBdLmVudlszXS52YWx1ZSA9IGBDbHVzdGVyTmFtZT0ke3Byb3BzLmNsdXN0ZXIuY2x1c3Rlck5hbWV9YDtcclxuICAgIGRlcGxveW1lbnRZYW1sWzJdLnNwZWMudGVtcGxhdGUuc3BlYy5jb250YWluZXJzWzBdLmVudls1XS52YWx1ZSA9IHByb3BzLnJlZ2lvbjtcclxuICAgIGRlcGxveW1lbnRZYW1sWzJdLnNwZWMudGVtcGxhdGUuc3BlYy5jb250YWluZXJzWzFdLmVudlswXS52YWx1ZSA9IHByb3BzLnJlZ2lvbjtcclxuICAgIGRlcGxveW1lbnRZYW1sWzNdLnNwZWMudGFyZ2V0R3JvdXBBUk4gPSBwcm9wcy50YXJnZXRHcm91cEFybjtcclxuXHJcbiAgICBjb25zdCBkZXBsb3ltZW50TWFuaWZlc3QgPSBuZXcgZWtzLkt1YmVybmV0ZXNNYW5pZmVzdCh0aGlzLFwicGV0c2l0ZWRlcGxveW1lbnRcIix7XHJcbiAgICAgICAgY2x1c3RlcjogcHJvcHMuY2x1c3RlcixcclxuICAgICAgICBtYW5pZmVzdDogZGVwbG95bWVudFlhbWxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbn1cclxuIl19