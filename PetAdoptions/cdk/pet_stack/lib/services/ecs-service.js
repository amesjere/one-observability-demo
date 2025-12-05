"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EcsService = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const iam = require("aws-cdk-lib/aws-iam");
const ecs = require("aws-cdk-lib/aws-ecs");
const logs = require("aws-cdk-lib/aws-logs");
const ecs_patterns = require("aws-cdk-lib/aws-ecs-patterns");
const constructs_1 = require("constructs");
class EcsService extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const logging = new ecs.AwsLogDriver({
            streamPrefix: "logs",
            logGroup: new logs.LogGroup(this, "ecs-log-group", {
                logGroupName: props.logGroupName,
                removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
            })
        });
        /*
        const firelenslogging = new ecs.FireLensLogDriver({
          options: {
            "Name": "cloudwatch",
            "region": props.region,
            "log_key": "log",
            "log_group_name": props.logGroupName,
            "auto_create_group": "false",
            "log_stream_name": "$(ecs_task_id)"
          }
        });
       //*/
        const taskRole = new iam.Role(this, `taskRole`, {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
        });
        this.taskDefinition = new ecs.FargateTaskDefinition(this, "taskDefinition", {
            cpu: props.cpu,
            taskRole: taskRole,
            memoryLimitMiB: props.memoryLimitMiB
        });
        this.taskDefinition.addToExecutionRolePolicy(EcsService.ExecutionRolePolicy);
        this.taskDefinition.taskRole?.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AmazonECSTaskExecutionRolePolicy', 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'));
        this.taskDefinition.taskRole?.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AWSXrayWriteOnlyAccess', 'arn:aws:iam::aws:policy/AWSXrayWriteOnlyAccess'));
        // Build locally the image only if the repository URI is not specified
        // Can help speed up builds if we are not rebuilding anything
        const image = props.repositoryURI ? this.containerImageFromRepository(props.repositoryURI) : this.createContainerImage();
        this.container = this.taskDefinition.addContainer('container', {
            image: image,
            memoryLimitMiB: 512,
            cpu: 256,
            logging,
            environment: {
                AWS_REGION: props.region,
            }
        });
        this.container.addPortMappings({
            containerPort: 80,
            protocol: ecs.Protocol.TCP
        });
        /*
        this.taskDefinition.addFirelensLogRouter('firelensrouter', {
          firelensConfig: {
            type: ecs.FirelensLogRouterType.FLUENTBIT
          },
          image: ecs.ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-for-fluent-bit:stable')
        })
       //*/
        // sidecar for instrumentation collecting
        switch (props.instrumentation) {
            // we don't add any sidecar if instrumentation is none
            case "none": {
                break;
            }
            // This collector would be used for both traces collected using
            // open telemetry or X-Ray
            case "otel": {
                this.addOtelCollectorContainer(this.taskDefinition, logging);
                break;
            }
            // Default X-Ray traces collector
            case "xray": {
                this.addXRayContainer(this.taskDefinition, logging);
                break;
            }
            // Default X-Ray traces collector
            // enabled by default
            default: {
                this.addXRayContainer(this.taskDefinition, logging);
                break;
            }
        }
        if (!props.disableService) {
            this.service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "ecs-service", {
                cluster: props.cluster,
                taskDefinition: this.taskDefinition,
                publicLoadBalancer: true,
                desiredCount: props.desiredTaskCount,
                listenerPort: 80,
                securityGroups: [props.securityGroup]
            });
            if (props.healthCheck) {
                this.service.targetGroup.configureHealthCheck({
                    path: props.healthCheck
                });
            }
        }
    }
    addXRayContainer(taskDefinition, logging) {
        taskDefinition.addContainer('xraydaemon', {
            image: ecs.ContainerImage.fromRegistry('public.ecr.aws/xray/aws-xray-daemon:3.3.4'),
            memoryLimitMiB: 256,
            cpu: 256,
            logging
        }).addPortMappings({
            containerPort: 2000,
            protocol: ecs.Protocol.UDP
        });
    }
    addOtelCollectorContainer(taskDefinition, logging) {
        taskDefinition.addContainer('aws-otel-collector', {
            image: ecs.ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-otel-collector:v0.41.1'),
            memoryLimitMiB: 256,
            cpu: 256,
            command: ["--config", "/etc/ecs/ecs-xray.yaml"],
            logging
        });
    }
}
exports.EcsService = EcsService;
EcsService.ExecutionRolePolicy = new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    resources: ['*'],
    actions: [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "logs:CreateLogGroup",
        "logs:DescribeLogStreams",
        "logs:CreateLogStream",
        "logs:DescribeLogGroups",
        "logs:PutLogEvents",
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords",
        "xray:GetSamplingRules",
        "xray:GetSamplingTargets",
        "xray:GetSamplingStatisticSummaries",
        'ssm:GetParameters'
    ]
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWNzLXNlcnZpY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJlY3Mtc2VydmljZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2Q0FBNEM7QUFDNUMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyw2Q0FBNkM7QUFDN0MsNkRBQTZEO0FBRTdELDJDQUFzQztBQXVCdEMsTUFBc0IsVUFBVyxTQUFRLHNCQUFTO0lBNEJoRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsTUFBTSxPQUFPLEdBQUcsSUFBSSxHQUFHLENBQUMsWUFBWSxDQUFDO1lBQ25DLFlBQVksRUFBRSxNQUFNO1lBQ3BCLFFBQVEsRUFBRSxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtnQkFDakQsWUFBWSxFQUFFLEtBQUssQ0FBQyxZQUFZO2dCQUNoQyxhQUFhLEVBQUUsMkJBQWEsQ0FBQyxPQUFPO2FBQ3JDLENBQUM7U0FDSCxDQUFDLENBQUM7UUFFSDs7Ozs7Ozs7Ozs7V0FXRztRQUVILE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFO1lBQzlDLFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyx5QkFBeUIsQ0FBQztTQUMvRCxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksR0FBRyxDQUFDLHFCQUFxQixDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUMxRSxHQUFHLEVBQUUsS0FBSyxDQUFDLEdBQUc7WUFDZCxRQUFRLEVBQUUsUUFBUTtZQUNsQixjQUFjLEVBQUUsS0FBSyxDQUFDLGNBQWM7U0FDckMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLGNBQWMsQ0FBQyx3QkFBd0IsQ0FBQyxVQUFVLENBQUMsbUJBQW1CLENBQUMs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IH0gZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCAqIGFzIGVjcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzJztcclxuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XHJcbmltcG9ydCAqIGFzIGVjc19wYXR0ZXJucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzLXBhdHRlcm5zJztcclxuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJ1xyXG5cclxuZXhwb3J0IGludGVyZmFjZSBFY3NTZXJ2aWNlUHJvcHMge1xyXG4gIGNsdXN0ZXI/OiBlY3MuQ2x1c3RlcixcclxuXHJcbiAgY3B1OiBudW1iZXI7XHJcbiAgbWVtb3J5TGltaXRNaUI6IG51bWJlcixcclxuICBsb2dHcm91cE5hbWU6IHN0cmluZyxcclxuXHJcbiAgaGVhbHRoQ2hlY2s/OiBzdHJpbmcsXHJcblxyXG4gIGRpc2FibGVTZXJ2aWNlPzogYm9vbGVhbixcclxuICBpbnN0cnVtZW50YXRpb24/OiBzdHJpbmcsXHJcblxyXG4gIHJlcG9zaXRvcnlVUkk/OiBzdHJpbmcsXHJcblxyXG4gIGRlc2lyZWRUYXNrQ291bnQ6IG51bWJlcixcclxuXHJcbiAgcmVnaW9uOiBzdHJpbmcsXHJcblxyXG4gIHNlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwXHJcbn1cclxuXHJcbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBFY3NTZXJ2aWNlIGV4dGVuZHMgQ29uc3RydWN0IHtcclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgRXhlY3V0aW9uUm9sZVBvbGljeSA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgIHJlc291cmNlczogWycqJ10sXHJcbiAgICBhY3Rpb25zOiBbXHJcbiAgICAgIFwiZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlblwiLFxyXG4gICAgICBcImVjcjpCYXRjaENoZWNrTGF5ZXJBdmFpbGFiaWxpdHlcIixcclxuICAgICAgXCJlY3I6R2V0RG93bmxvYWRVcmxGb3JMYXllclwiLFxyXG4gICAgICBcImVjcjpCYXRjaEdldEltYWdlXCIsXHJcbiAgICAgIFwibG9nczpDcmVhdGVMb2dHcm91cFwiLFxyXG4gICAgICBcImxvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zXCIsXHJcbiAgICAgIFwibG9nczpDcmVhdGVMb2dTdHJlYW1cIixcclxuICAgICAgXCJsb2dzOkRlc2NyaWJlTG9nR3JvdXBzXCIsXHJcbiAgICAgIFwibG9nczpQdXRMb2dFdmVudHNcIixcclxuICAgICAgXCJ4cmF5OlB1dFRyYWNlU2VnbWVudHNcIixcclxuICAgICAgXCJ4cmF5OlB1dFRlbGVtZXRyeVJlY29yZHNcIixcclxuICAgICAgXCJ4cmF5OkdldFNhbXBsaW5nUnVsZXNcIixcclxuICAgICAgXCJ4cmF5OkdldFNhbXBsaW5nVGFyZ2V0c1wiLFxyXG4gICAgICBcInhyYXk6R2V0U2FtcGxpbmdTdGF0aXN0aWNTdW1tYXJpZXNcIixcclxuICAgICAgJ3NzbTpHZXRQYXJhbWV0ZXJzJ1xyXG4gICAgXVxyXG4gIH0pO1xyXG5cclxuICBwdWJsaWMgcmVhZG9ubHkgdGFza0RlZmluaXRpb246IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb247XHJcbiAgcHVibGljIHJlYWRvbmx5IHNlcnZpY2U6IGVjc19wYXR0ZXJucy5BcHBsaWNhdGlvbkxvYWRCYWxhbmNlZFNlcnZpY2VCYXNlO1xyXG4gIHB1YmxpYyByZWFkb25seSBjb250YWluZXI6IGVjcy5Db250YWluZXJEZWZpbml0aW9uO1xyXG5cclxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogRWNzU2VydmljZVByb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQpO1xyXG5cclxuICAgIGNvbnN0IGxvZ2dpbmcgPSBuZXcgZWNzLkF3c0xvZ0RyaXZlcih7XHJcbiAgICAgIHN0cmVhbVByZWZpeDogXCJsb2dzXCIsXHJcbiAgICAgIGxvZ0dyb3VwOiBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCBcImVjcy1sb2ctZ3JvdXBcIiwge1xyXG4gICAgICAgIGxvZ0dyb3VwTmFtZTogcHJvcHMubG9nR3JvdXBOYW1lLFxyXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWVxyXG4gICAgICB9KVxyXG4gICAgfSk7XHJcblxyXG4gICAgLypcclxuICAgIGNvbnN0IGZpcmVsZW5zbG9nZ2luZyA9IG5ldyBlY3MuRmlyZUxlbnNMb2dEcml2ZXIoe1xyXG4gICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgXCJOYW1lXCI6IFwiY2xvdWR3YXRjaFwiLFxyXG4gICAgICAgIFwicmVnaW9uXCI6IHByb3BzLnJlZ2lvbixcclxuICAgICAgICBcImxvZ19rZXlcIjogXCJsb2dcIixcclxuICAgICAgICBcImxvZ19ncm91cF9uYW1lXCI6IHByb3BzLmxvZ0dyb3VwTmFtZSxcclxuICAgICAgICBcImF1dG9fY3JlYXRlX2dyb3VwXCI6IFwiZmFsc2VcIixcclxuICAgICAgICBcImxvZ19zdHJlYW1fbmFtZVwiOiBcIiQoZWNzX3Rhc2tfaWQpXCJcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgIC8vKi9cclxuXHJcbiAgICBjb25zdCB0YXNrUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCBgdGFza1JvbGVgLCB7XHJcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlY3MtdGFza3MuYW1hem9uYXdzLmNvbScpXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLnRhc2tEZWZpbml0aW9uID0gbmV3IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24odGhpcywgXCJ0YXNrRGVmaW5pdGlvblwiLCB7XHJcbiAgICAgIGNwdTogcHJvcHMuY3B1LFxyXG4gICAgICB0YXNrUm9sZTogdGFza1JvbGUsXHJcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiBwcm9wcy5tZW1vcnlMaW1pdE1pQlxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy50YXNrRGVmaW5pdGlvbi5hZGRUb0V4ZWN1dGlvblJvbGVQb2xpY3koRWNzU2VydmljZS5FeGVjdXRpb25Sb2xlUG9saWN5KTtcclxuICAgIHRoaXMudGFza0RlZmluaXRpb24udGFza1JvbGU/LmFkZE1hbmFnZWRQb2xpY3koaWFtLk1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4odGhpcywgJ0FtYXpvbkVDU1Rhc2tFeGVjdXRpb25Sb2xlUG9saWN5JywgJ2Fybjphd3M6aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BbWF6b25FQ1NUYXNrRXhlY3V0aW9uUm9sZVBvbGljeScpKTtcclxuICAgIHRoaXMudGFza0RlZmluaXRpb24udGFza1JvbGU/LmFkZE1hbmFnZWRQb2xpY3koaWFtLk1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4odGhpcywgJ0FXU1hyYXlXcml0ZU9ubHlBY2Nlc3MnLCAnYXJuOmF3czppYW06OmF3czpwb2xpY3kvQVdTWHJheVdyaXRlT25seUFjY2VzcycpKTtcclxuXHJcbiAgICAvLyBCdWlsZCBsb2NhbGx5IHRoZSBpbWFnZSBvbmx5IGlmIHRoZSByZXBvc2l0b3J5IFVSSSBpcyBub3Qgc3BlY2lmaWVkXHJcbiAgICAvLyBDYW4gaGVscCBzcGVlZCB1cCBidWlsZHMgaWYgd2UgYXJlIG5vdCByZWJ1aWxkaW5nIGFueXRoaW5nXHJcbiAgICBjb25zdCBpbWFnZSA9IHByb3BzLnJlcG9zaXRvcnlVUkkgPyB0aGlzLmNvbnRhaW5lckltYWdlRnJvbVJlcG9zaXRvcnkocHJvcHMucmVwb3NpdG9yeVVSSSkgOiB0aGlzLmNyZWF0ZUNvbnRhaW5lckltYWdlKClcclxuXHJcbiAgICB0aGlzLmNvbnRhaW5lciA9IHRoaXMudGFza0RlZmluaXRpb24uYWRkQ29udGFpbmVyKCdjb250YWluZXInLCB7XHJcbiAgICAgIGltYWdlOiBpbWFnZSxcclxuICAgICAgbWVtb3J5TGltaXRNaUI6IDUxMixcclxuICAgICAgY3B1OiAyNTYsXHJcbiAgICAgIGxvZ2dpbmcsXHJcbiAgICAgIGVudmlyb25tZW50OiB7IC8vIGNsZWFyIHRleHQsIG5vdCBmb3Igc2Vuc2l0aXZlIGRhdGFcclxuICAgICAgICBBV1NfUkVHSU9OOiBwcm9wcy5yZWdpb24sXHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuY29udGFpbmVyLmFkZFBvcnRNYXBwaW5ncyh7XHJcbiAgICAgIGNvbnRhaW5lclBvcnQ6IDgwLFxyXG4gICAgICBwcm90b2NvbDogZWNzLlByb3RvY29sLlRDUFxyXG4gICAgfSk7XHJcblxyXG4gICAgLypcclxuICAgIHRoaXMudGFza0RlZmluaXRpb24uYWRkRmlyZWxlbnNMb2dSb3V0ZXIoJ2ZpcmVsZW5zcm91dGVyJywge1xyXG4gICAgICBmaXJlbGVuc0NvbmZpZzoge1xyXG4gICAgICAgIHR5cGU6IGVjcy5GaXJlbGVuc0xvZ1JvdXRlclR5cGUuRkxVRU5UQklUXHJcbiAgICAgIH0sXHJcbiAgICAgIGltYWdlOiBlY3MuQ29udGFpbmVySW1hZ2UuZnJvbVJlZ2lzdHJ5KCdwdWJsaWMuZWNyLmF3cy9hd3Mtb2JzZXJ2YWJpbGl0eS9hd3MtZm9yLWZsdWVudC1iaXQ6c3RhYmxlJylcclxuICAgIH0pXHJcbiAgIC8vKi9cclxuXHJcbiAgICAvLyBzaWRlY2FyIGZvciBpbnN0cnVtZW50YXRpb24gY29sbGVjdGluZ1xyXG4gICAgc3dpdGNoIChwcm9wcy5pbnN0cnVtZW50YXRpb24pIHtcclxuXHJcbiAgICAgIC8vIHdlIGRvbid0IGFkZCBhbnkgc2lkZWNhciBpZiBpbnN0cnVtZW50YXRpb24gaXMgbm9uZVxyXG4gICAgICBjYXNlIFwibm9uZVwiOiB7XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFRoaXMgY29sbGVjdG9yIHdvdWxkIGJlIHVzZWQgZm9yIGJvdGggdHJhY2VzIGNvbGxlY3RlZCB1c2luZ1xyXG4gICAgICAvLyBvcGVuIHRlbGVtZXRyeSBvciBYLVJheVxyXG4gICAgICBjYXNlIFwib3RlbFwiOiB7XHJcbiAgICAgICAgdGhpcy5hZGRPdGVsQ29sbGVjdG9yQ29udGFpbmVyKHRoaXMudGFza0RlZmluaXRpb24sIGxvZ2dpbmcpO1xyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBEZWZhdWx0IFgtUmF5IHRyYWNlcyBjb2xsZWN0b3JcclxuICAgICAgY2FzZSBcInhyYXlcIjoge1xyXG4gICAgICAgIHRoaXMuYWRkWFJheUNvbnRhaW5lcih0aGlzLnRhc2tEZWZpbml0aW9uLCBsb2dnaW5nKTtcclxuICAgICAgICBicmVhaztcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gRGVmYXVsdCBYLVJheSB0cmFjZXMgY29sbGVjdG9yXHJcbiAgICAgIC8vIGVuYWJsZWQgYnkgZGVmYXVsdFxyXG4gICAgICBkZWZhdWx0OiB7XHJcbiAgICAgICAgdGhpcy5hZGRYUmF5Q29udGFpbmVyKHRoaXMudGFza0RlZmluaXRpb24sIGxvZ2dpbmcpO1xyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFwcm9wcy5kaXNhYmxlU2VydmljZSkge1xyXG4gICAgICB0aGlzLnNlcnZpY2UgPSBuZXcgZWNzX3BhdHRlcm5zLkFwcGxpY2F0aW9uTG9hZEJhbGFuY2VkRmFyZ2F0ZVNlcnZpY2UodGhpcywgXCJlY3Mtc2VydmljZVwiLCB7XHJcbiAgICAgICAgY2x1c3RlcjogcHJvcHMuY2x1c3RlcixcclxuICAgICAgICB0YXNrRGVmaW5pdGlvbjogdGhpcy50YXNrRGVmaW5pdGlvbixcclxuICAgICAgICBwdWJsaWNMb2FkQmFsYW5jZXI6IHRydWUsXHJcbiAgICAgICAgZGVzaXJlZENvdW50OiBwcm9wcy5kZXNpcmVkVGFza0NvdW50LFxyXG4gICAgICAgIGxpc3RlbmVyUG9ydDogODAsXHJcbiAgICAgICAgc2VjdXJpdHlHcm91cHM6IFtwcm9wcy5zZWN1cml0eUdyb3VwXVxyXG5cclxuICAgICAgfSlcclxuXHJcbiAgICAgIGlmIChwcm9wcy5oZWFsdGhDaGVjaykge1xyXG4gICAgICAgIHRoaXMuc2VydmljZS50YXJnZXRHcm91cC5jb25maWd1cmVIZWFsdGhDaGVjayh7XHJcbiAgICAgICAgICBwYXRoOiBwcm9wcy5oZWFsdGhDaGVja1xyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhYnN0cmFjdCBjb250YWluZXJJbWFnZUZyb21SZXBvc2l0b3J5KHJlcG9zaXRvcnlVUkk6IHN0cmluZyk6IGVjcy5Db250YWluZXJJbWFnZTtcclxuXHJcbiAgYWJzdHJhY3QgY3JlYXRlQ29udGFpbmVySW1hZ2UoKTogZWNzLkNvbnRhaW5lckltYWdlO1xyXG5cclxuICBwcml2YXRlIGFkZFhSYXlDb250YWluZXIodGFza0RlZmluaXRpb246IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24sIGxvZ2dpbmc6IGVjcy5Bd3NMb2dEcml2ZXIpIHtcclxuICAgIHRhc2tEZWZpbml0aW9uLmFkZENvbnRhaW5lcigneHJheWRhZW1vbicsIHtcclxuICAgICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tUmVnaXN0cnkoJ3B1YmxpYy5lY3IuYXdzL3hyYXkvYXdzLXhyYXktZGFlbW9uOjMuMy40JyksXHJcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiAyNTYsXHJcbiAgICAgIGNwdTogMjU2LFxyXG4gICAgICBsb2dnaW5nXHJcbiAgICB9KS5hZGRQb3J0TWFwcGluZ3Moe1xyXG4gICAgICBjb250YWluZXJQb3J0OiAyMDAwLFxyXG4gICAgICBwcm90b2NvbDogZWNzLlByb3RvY29sLlVEUFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFkZE90ZWxDb2xsZWN0b3JDb250YWluZXIodGFza0RlZmluaXRpb246IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24sIGxvZ2dpbmc6IGVjcy5Bd3NMb2dEcml2ZXIpIHtcclxuICAgIHRhc2tEZWZpbml0aW9uLmFkZENvbnRhaW5lcignYXdzLW90ZWwtY29sbGVjdG9yJywge1xyXG4gICAgICBpbWFnZTogZWNzLkNvbnRhaW5lckltYWdlLmZyb21SZWdpc3RyeSgncHVibGljLmVjci5hd3MvYXdzLW9ic2VydmFiaWxpdHkvYXdzLW90ZWwtY29sbGVjdG9yOnYwLjQxLjEnKSxcclxuICAgICAgbWVtb3J5TGltaXRNaUI6IDI1NixcclxuICAgICAgY3B1OiAyNTYsXHJcbiAgICAgIGNvbW1hbmQ6IFtcIi0tY29uZmlnXCIsIFwiL2V0Yy9lY3MvZWNzLXhyYXkueWFtbFwiXSxcclxuICAgICAgbG9nZ2luZ1xyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcbiJdfQ==