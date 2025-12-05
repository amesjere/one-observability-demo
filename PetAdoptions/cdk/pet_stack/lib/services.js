"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Services = void 0;
const iam = require("aws-cdk-lib/aws-iam");
const ec2 = require("aws-cdk-lib/aws-ec2");
const ecs = require("aws-cdk-lib/aws-ecs");
const sns = require("aws-cdk-lib/aws-sns");
const sqs = require("aws-cdk-lib/aws-sqs");
const subs = require("aws-cdk-lib/aws-sns-subscriptions");
const ddb = require("aws-cdk-lib/aws-dynamodb");
const s3 = require("aws-cdk-lib/aws-s3");
const s3seeder = require("aws-cdk-lib/aws-s3-deployment");
const rds = require("aws-cdk-lib/aws-rds");
const ssm = require("aws-cdk-lib/aws-ssm");
const kms = require("aws-cdk-lib/aws-kms");
const eks = require("aws-cdk-lib/aws-eks");
const yaml = require("js-yaml");
const path = require("path");
const lambda = require("aws-cdk-lib/aws-lambda");
const elbv2 = require("aws-cdk-lib/aws-elasticloadbalancingv2");
const cloudwatch = require("aws-cdk-lib/aws-cloudwatch");
const applicationinsights = require("aws-cdk-lib/aws-applicationinsights");
const resourcegroups = require("aws-cdk-lib/aws-resourcegroups");
const pay_for_adoption_service_1 = require("./services/pay-for-adoption-service");
const list_adoptions_service_1 = require("./services/list-adoptions-service");
const search_service_1 = require("./services/search-service");
const traffic_generator_service_1 = require("./services/traffic-generator-service");
const status_updater_service_1 = require("./services/status-updater-service");
const stepfn_1 = require("./services/stepfn");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const fs_1 = require("fs");
require("ts-replace-all");
const aws_cloudwatch_1 = require("aws-cdk-lib/aws-cloudwatch");
const lambda_layer_kubectl_v31_1 = require("@aws-cdk/lambda-layer-kubectl-v31");
class Services extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const stackName = id;
        // Create SQS resource to send Pet adoption messages to
        const sqsQueue = new sqs.Queue(this, 'sqs_petadoption', {
            visibilityTimeout: aws_cdk_lib_1.Duration.seconds(300)
        });
        // Create SNS and an email topic to send notifications to
        const topic_petadoption = new sns.Topic(this, 'topic_petadoption');
        var topic_email = this.node.tryGetContext('snstopic_email');
        if (topic_email == undefined) {
            topic_email = "someone@example.com";
        }
        topic_petadoption.addSubscription(new subs.EmailSubscription(topic_email));
        // Creates an S3 bucket to store pet images
        const s3_observabilitypetadoptions = new s3.Bucket(this, 's3bucket_petadoption', {
            publicReadAccess: false,
            autoDeleteObjects: true,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        // Creates the DynamoDB table for Petadoption data
        const dynamodb_petadoption = new ddb.Table(this, 'ddb_petadoption', {
            partitionKey: {
                name: 'pettype',
                type: ddb.AttributeType.STRING
            },
            sortKey: {
                name: 'petid',
                type: ddb.AttributeType.STRING
            },
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
        });
        dynamodb_petadoption.metric('WriteThrottleEvents', { statistic: "avg" }).createAlarm(this, 'WriteThrottleEvents-BasicAlarm', {
            threshold: 0,
            comparisonOperator: aws_cloudwatch_1.ComparisonOperator.GREATER_THAN_THRESHOLD,
        });
        dynamodb_petadoption.metric('ReadThrottleEvents', { statistic: "avg" }).createAlarm(this, 'ReadThrottleEvents-BasicAlarm', {
            threshold: 0,
            comparisonOperator: aws_cloudwatch_1.ComparisonOperator.GREATER_THAN_THRESHOLD,
        });
        // Seeds the S3 bucket with pet images
        new s3seeder.BucketDeployment(this, "s3seeder_petadoption", {
            destinationBucket: s3_observabilitypetadoptions,
            sources: [s3seeder.Source.asset('./resources/kitten.zip'), s3seeder.Source.asset('./resources/puppies.zip'), s3seeder.Source.asset('./resources/bunnies.zip')]
        });
        var cidrRange = this.node.tryGetContext('vpc_cidr');
        if (cidrRange == undefined) {
            cidrRange = "11.0.0.0/16";
        }
        // The VPC where all the microservices will be deployed into
        const theVPC = new ec2.Vpc(this, 'Microservices', {
            ipAddresses: ec2.IpAddresses.cidr(cidrRange),
            natGateways: 1,
            maxAzs: 2
        });
        // Disable Map IP on launch for all public subnets
        const publicSubnets = theVPC.selectSubnets({
            subnetType: ec2.SubnetType.PUBLIC,
        });
        for (const subnet of publicSubnets.subnets) {
            const cfnSubnet = subnet.node.defaultChild;
            cfnSubnet.mapPublicIpOnLaunch = false;
        }
        // Create RDS Aurora PG cluster
        const rdssecuritygroup = new ec2.SecurityGroup(this, 'petadoptionsrdsSG', {
            vpc: theVPC
        });
        rdssecuritygroup.addIngressRule(ec2.Peer.ipv4(theVPC.vpcCidrBlock), ec2.Port.tcp(5432), 'Allow Aurora PG access from within the VPC CIDR range');
        var rdsUsername = this.node.tryGetContext('rdsusername');
        if (rdsUsername == undefined) {
            rdsUsername = "petadmin";
        }
        const auroraCluster = new rds.DatabaseCluster(this, 'Database', {
            engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_6 }),
            parameterGroup: rds.ParameterGroup.fromParameterGroupName(this, 'ParameterGroup', 'default.aurora-postgresql16'),
            vpc: theVPC,
            securityGroups: [rdssecuritygroup],
            defaultDatabaseName: 'adoptions',
            databaseInsightsMode: rds.DatabaseInsightsMode.ADVANCED,
            performanceInsightRetention: rds.PerformanceInsightRetention.MONTHS_15,
            writer: rds.ClusterInstance.provisioned('writer', {
                autoMinorVersionUpgrade: true,
                instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
            }),
            readers: [
                rds.ClusterInstance.provisioned('reader1', {
                    promotionTier: 1,
                    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
                }),
            ],
        });
        const readSSMParamsPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ssm:GetParametersByPath',
                'ssm:GetParameters',
                'ssm:GetParameter',
                'ec2:DescribeVpcs'
            ],
            resources: ['*']
        });
        const ddbSeedPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'dynamodb:BatchWriteItem',
                'dynamodb:ListTables',
                "dynamodb:Scan",
                "dynamodb:Query"
            ],
            resources: ['*']
        });
        const repositoryURI = "public.ecr.aws/one-observability-workshop";
        const stack = aws_cdk_lib_1.Stack.of(this);
        const region = stack.region;
        const ecsServicesSecurityGroup = new ec2.SecurityGroup(this, 'ECSServicesSG', {
            vpc: theVPC
        });
        ecsServicesSecurityGroup.addIngressRule(ec2.Peer.ipv4(theVPC.vpcCidrBlock), ec2.Port.tcp(80));
        const ecsPayForAdoptionCluster = new ecs.Cluster(this, "PayForAdoption", {
            vpc: theVPC,
            containerInsightsV2: ecs.ContainerInsights.ENHANCED
        });
        // PayForAdoption service definitions-----------------------------------------------------------------------
        const payForAdoptionService = new pay_for_adoption_service_1.PayForAdoptionService(this, 'pay-for-adoption-service', {
            cluster: ecsPayForAdoptionCluster,
            logGroupName: "/ecs/PayForAdoption",
            cpu: 1024,
            memoryLimitMiB: 2048,
            healthCheck: '/health/status',
            instrumentation: 'otel',
            database: auroraCluster,
            desiredTaskCount: 2,
            region: region,
            securityGroup: ecsServicesSecurityGroup
        });
        payForAdoptionService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);
        payForAdoptionService.taskDefinition.taskRole?.addToPrincipalPolicy(ddbSeedPolicy);
        const ecsPetListAdoptionCluster = new ecs.Cluster(this, "PetListAdoptions", {
            vpc: theVPC,
            containerInsightsV2: ecs.ContainerInsights.ENHANCED
        });
        // PetListAdoptions service definitions-----------------------------------------------------------------------
        const listAdoptionsService = new list_adoptions_service_1.ListAdoptionsService(this, 'list-adoptions-service', {
            cluster: ecsPetListAdoptionCluster,
            logGroupName: "/ecs/PetListAdoptions",
            cpu: 1024,
            memoryLimitMiB: 2048,
            healthCheck: '/health/status',
            instrumentation: 'otel',
            database: auroraCluster,
            desiredTaskCount: 2,
            region: region,
            securityGroup: ecsServicesSecurityGroup
        });
        listAdoptionsService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);
        const ecsPetSearchCluster = new ecs.Cluster(this, "PetSearch", {
            vpc: theVPC,
            containerInsightsV2: ecs.ContainerInsights.ENHANCED
        });
        // PetSearch service definitions-----------------------------------------------------------------------
        const searchService = new search_service_1.SearchService(this, 'search-service', {
            cluster: ecsPetSearchCluster,
            logGroupName: "/ecs/PetSearch",
            cpu: 1024,
            memoryLimitMiB: 2048,
            //repositoryURI: repositoryURI,
            healthCheck: '/health/status',
            desiredTaskCount: 2,
            instrumentation: 'otel',
            region: region,
            securityGroup: ecsServicesSecurityGroup
        });
        searchService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);
        // Traffic Generator task definition.
        const trafficGeneratorService = new traffic_generator_service_1.TrafficGeneratorService(this, 'traffic-generator-service', {
            cluster: ecsPetListAdoptionCluster,
            logGroupName: "/ecs/PetTrafficGenerator",
            cpu: 256,
            memoryLimitMiB: 512,
            instrumentation: 'none',
            //repositoryURI: repositoryURI,
            desiredTaskCount: 1,
            region: region,
            securityGroup: ecsServicesSecurityGroup
        });
        trafficGeneratorService.taskDefinition.taskRole?.addToPrincipalPolicy(readSSMParamsPolicy);
        //PetStatusUpdater Lambda Function and APIGW--------------------------------------
        const statusUpdaterService = new status_updater_service_1.StatusUpdaterService(this, 'status-updater-service', {
            tableName: dynamodb_petadoption.tableName
        });
        const albSG = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
            vpc: theVPC,
            securityGroupName: 'ALBSecurityGroup',
            allowAllOutbound: true
        });
        albSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));
        // PetSite - Create ALB and Target Groups
        const alb = new elbv2.ApplicationLoadBalancer(this, 'PetSiteLoadBalancer', {
            vpc: theVPC,
            internetFacing: true,
            securityGroup: albSG
        });
        trafficGeneratorService.node.addDependency(alb);
        const targetGroup = new elbv2.ApplicationTargetGroup(this, 'PetSiteTargetGroup', {
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            vpc: theVPC,
            targetType: elbv2.TargetType.IP
        });
        new ssm.StringParameter(this, "putParamTargetGroupArn", {
            stringValue: targetGroup.targetGroupArn,
            parameterName: '/eks/petsite/TargetGroupArn'
        });
        const listener = alb.addListener('Listener', {
            port: 80,
            open: true,
            defaultTargetGroups: [targetGroup],
        });
        // PetAdoptionHistory - attach service to path /petadoptionhistory on PetSite ALB
        const petadoptionshistory_targetGroup = new elbv2.ApplicationTargetGroup(this, 'PetAdoptionsHistoryTargetGroup', {
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            vpc: theVPC,
            targetType: elbv2.TargetType.IP,
            healthCheck: {
                path: '/health/status',
            }
        });
        listener.addTargetGroups('PetAdoptionsHistoryTargetGroups', {
            priority: 10,
            conditions: [
                elbv2.ListenerCondition.pathPatterns(['/petadoptionshistory/*']),
            ],
            targetGroups: [petadoptionshistory_targetGroup]
        });
        new ssm.StringParameter(this, "putPetHistoryParamTargetGroupArn", {
            stringValue: petadoptionshistory_targetGroup.targetGroupArn,
            parameterName: '/eks/pethistory/TargetGroupArn'
        });
        // PetSite - EKS Cluster
        const clusterAdmin = new iam.Role(this, 'AdminRole', {
            assumedBy: new iam.AccountRootPrincipal()
        });
        new ssm.StringParameter(this, "putParam", {
            stringValue: clusterAdmin.roleArn,
            parameterName: '/eks/petsite/EKSMasterRoleArn'
        });
        const secretsKey = new kms.Key(this, 'SecretsKey');
        const cluster = new eks.Cluster(this, 'petsite', {
            clusterName: 'PetSite',
            mastersRole: clusterAdmin,
            vpc: theVPC,
            defaultCapacity: 2,
            defaultCapacityInstance: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
            secretsEncryptionKey: secretsKey,
            version: eks.KubernetesVersion.V1_31,
            kubectlLayer: new lambda_layer_kubectl_v31_1.KubectlV31Layer(this, 'kubectl'),
            authenticationMode: eks.AuthenticationMode.API_AND_CONFIG_MAP,
        });
        const clusterSG = ec2.SecurityGroup.fromSecurityGroupId(this, 'ClusterSG', cluster.clusterSecurityGroupId);
        clusterSG.addIngressRule(albSG, ec2.Port.allTraffic(), 'Allow traffic from the ALB');
        clusterSG.addIngressRule(ec2.Peer.ipv4(theVPC.vpcCidrBlock), ec2.Port.tcp(443), 'Allow local access to k8s api');
        // Add SSM Permissions to the node role
        cluster.defaultNodegroup?.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));
        // From https://github.com/aws-samples/ssm-agent-daemonset-installer
        var ssmAgentSetup = yaml.loadAll((0, fs_1.readFileSync)("./resources/setup-ssm-agent.yaml", "utf8"));
        const ssmAgentSetupManifest = new eks.KubernetesManifest(this, "ssmAgentdeployment", {
            cluster: cluster,
            manifest: ssmAgentSetup
        });
        // ClusterID is not available for creating the proper conditions https://github.com/aws/aws-cdk/issues/10347
        const clusterId = aws_cdk_lib_1.Fn.select(4, aws_cdk_lib_1.Fn.split('/', cluster.clusterOpenIdConnectIssuerUrl)); // Remove https:// from the URL as workaround to get ClusterID
        const cw_federatedPrincipal = new iam.FederatedPrincipal(cluster.openIdConnectProvider.openIdConnectProviderArn, {
            StringEquals: new aws_cdk_lib_1.CfnJson(this, "CW_FederatedPrincipalCondition", {
                value: {
                    [`oidc.eks.${region}.amazonaws.com/id/${clusterId}:aud`]: "sts.amazonaws.com"
                }
            })
        });
        const cw_trustRelationship = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [cw_federatedPrincipal],
            actions: ["sts:AssumeRoleWithWebIdentity"]
        });
        // Create IAM roles for Service Accounts
        // Cloudwatch Agent SA
        const cwserviceaccount = new iam.Role(this, 'CWServiceAccount', {
            //                assumedBy: eksFederatedPrincipal,
            assumedBy: new iam.AccountRootPrincipal(),
            managedPolicies: [
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'CWServiceAccount-CloudWatchAgentServerPolicy', 'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy')
            ],
        });
        cwserviceaccount.assumeRolePolicy?.addStatements(cw_trustRelationship);
        const xray_federatedPrincipal = new iam.FederatedPrincipal(cluster.openIdConnectProvider.openIdConnectProviderArn, {
            StringEquals: new aws_cdk_lib_1.CfnJson(this, "Xray_FederatedPrincipalCondition", {
                value: {
                    [`oidc.eks.${region}.amazonaws.com/id/${clusterId}:aud`]: "sts.amazonaws.com"
                }
            })
        });
        const xray_trustRelationship = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [xray_federatedPrincipal],
            actions: ["sts:AssumeRoleWithWebIdentity"]
        });
        // X-Ray Agent SA
        const xrayserviceaccount = new iam.Role(this, 'XRayServiceAccount', {
            //                assumedBy: eksFederatedPrincipal,
            assumedBy: new iam.AccountRootPrincipal(),
            managedPolicies: [
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'XRayServiceAccount-AWSXRayDaemonWriteAccess', 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess')
            ],
        });
        xrayserviceaccount.assumeRolePolicy?.addStatements(xray_trustRelationship);
        const loadbalancer_federatedPrincipal = new iam.FederatedPrincipal(cluster.openIdConnectProvider.openIdConnectProviderArn, {
            StringEquals: new aws_cdk_lib_1.CfnJson(this, "LB_FederatedPrincipalCondition", {
                value: {
                    [`oidc.eks.${region}.amazonaws.com/id/${clusterId}:aud`]: "sts.amazonaws.com"
                }
            })
        });
        const loadBalancer_trustRelationship = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [loadbalancer_federatedPrincipal],
            actions: ["sts:AssumeRoleWithWebIdentity"]
        });
        const loadBalancerPolicyDoc = iam.PolicyDocument.fromJson(JSON.parse((0, fs_1.readFileSync)("./resources/load_balancer/iam_policy.json", "utf8")));
        const loadBalancerPolicy = new iam.ManagedPolicy(this, 'LoadBalancerSAPolicy', { document: loadBalancerPolicyDoc });
        const loadBalancerserviceaccount = new iam.Role(this, 'LoadBalancerServiceAccount', {
            //                assumedBy: eksFederatedPrincipal,
            assumedBy: new iam.AccountRootPrincipal(),
            managedPolicies: [loadBalancerPolicy]
        });
        loadBalancerserviceaccount.assumeRolePolicy?.addStatements(loadBalancer_trustRelationship);
        const eksAdminArn = this.node.tryGetContext('admin_role');
        if ((eksAdminArn != undefined) && (eksAdminArn.length > 0)) {
            const adminRole = iam.Role.fromRoleArn(this, "ekdAdminRoleArn", eksAdminArn, { mutable: false });
            cluster.grantAccess('TeamRoleAccess', adminRole.roleArn, [
                eks.AccessPolicy.fromAccessPolicyName('AmazonEKSClusterAdminPolicy', {
                    accessScopeType: eks.AccessScopeType.CLUSTER
                })
            ]);
        }
        var xRayYaml = yaml.loadAll((0, fs_1.readFileSync)("./resources/k8s_petsite/xray-daemon-config.yaml", "utf8"));
        xRayYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new aws_cdk_lib_1.CfnJson(this, "xray_Role", { value: `${xrayserviceaccount.roleArn}` });
        const xrayManifest = new eks.KubernetesManifest(this, "xraydeployment", {
            cluster: cluster,
            manifest: xRayYaml
        });
        var loadBalancerServiceAccountYaml = yaml.loadAll((0, fs_1.readFileSync)("./resources/load_balancer/service_account.yaml", "utf8"));
        loadBalancerServiceAccountYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new aws_cdk_lib_1.CfnJson(this, "loadBalancer_Role", { value: `${loadBalancerserviceaccount.roleArn}` });
        const loadBalancerServiceAccount = new eks.KubernetesManifest(this, "loadBalancerServiceAccount", {
            cluster: cluster,
            manifest: loadBalancerServiceAccountYaml
        });
        const waitForLBServiceAccount = new eks.KubernetesObjectValue(this, 'LBServiceAccount', {
            cluster: cluster,
            objectName: "alb-ingress-controller",
            objectType: "serviceaccount",
            objectNamespace: "kube-system",
            jsonPath: "@"
        });
        const loadBalancerCRDYaml = yaml.loadAll((0, fs_1.readFileSync)("./resources/load_balancer/crds.yaml", "utf8"));
        const loadBalancerCRDManifest = new eks.KubernetesManifest(this, "loadBalancerCRD", {
            cluster: cluster,
            manifest: loadBalancerCRDYaml
        });
        const awsLoadBalancerManifest = new eks.HelmChart(this, "AWSLoadBalancerController", {
            cluster: cluster,
            chart: "aws-load-balancer-controller",
            repository: "https://aws.github.io/eks-charts",
            namespace: "kube-system",
            values: {
                clusterName: "PetSite",
                serviceAccount: {
                    create: false,
                    name: "alb-ingress-controller"
                },
                wait: true
            }
        });
        awsLoadBalancerManifest.node.addDependency(loadBalancerCRDManifest);
        awsLoadBalancerManifest.node.addDependency(loadBalancerServiceAccount);
        awsLoadBalancerManifest.node.addDependency(waitForLBServiceAccount);
        // NOTE: Amazon CloudWatch Observability Addon for CloudWatch Agent and Fluentbit
        const otelAddon = new eks.CfnAddon(this, 'otelObservabilityAddon', {
            addonName: 'amazon-cloudwatch-observability',
            addonVersion: 'v4.4.0-eksbuild.1',
            clusterName: cluster.clusterName,
            // the properties below are optional
            resolveConflicts: 'OVERWRITE',
            preserveOnDelete: false,
            serviceAccountRoleArn: cwserviceaccount.roleArn,
        });
        // IAM Role for Network Flow Monitor
        const networkFlowMonitorRole = new iam.CfnRole(this, 'NetworkFlowMonitorRole', {
            assumeRolePolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Principal: {
                            Service: 'pods.eks.amazonaws.com',
                        },
                        Action: [
                            'sts:AssumeRole',
                            'sts:TagSession',
                        ],
                    },
                ],
            },
            managedPolicyArns: [
                'arn:aws:iam::aws:policy/CloudWatchNetworkFlowMonitorAgentPublishPolicy',
            ],
        });
        // Amazon EKS Pod Identity Agent Addon for Network Flow Monitor
        const podIdentityAgentAddon = new eks.CfnAddon(this, 'PodIdentityAgentAddon', {
            addonName: 'eks-pod-identity-agent',
            addonVersion: 'v1.3.4-eksbuild.1',
            clusterName: cluster.clusterName,
            resolveConflicts: 'OVERWRITE',
            preserveOnDelete: false,
        });
        // Amazon EKS AWS Network Flow Monitor Agent add-on
        const networkFlowMonitoringAgentAddon = new eks.CfnAddon(this, 'NetworkFlowMonitoringAgentAddon', {
            addonName: 'aws-network-flow-monitoring-agent',
            addonVersion: 'v1.0.1-eksbuild.2',
            clusterName: cluster.clusterName,
            resolveConflicts: 'OVERWRITE',
            preserveOnDelete: false,
            podIdentityAssociations: [
                {
                    roleArn: networkFlowMonitorRole.attrArn,
                    serviceAccount: 'aws-network-flow-monitor-agent-service-account',
                },
            ],
        });
        const customWidgetResourceControllerPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ecs:ListServices',
                'ecs:UpdateService',
                'eks:DescribeNodegroup',
                'eks:ListNodegroups',
                'eks:DescribeUpdate',
                'eks:UpdateNodegroupConfig',
                'ecs:DescribeServices',
                'eks:DescribeCluster',
                'eks:ListClusters',
                'ecs:ListClusters'
            ],
            resources: ['*']
        });
        var customWidgetLambdaRole = new iam.Role(this, 'customWidgetLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        });
        customWidgetLambdaRole.addToPrincipalPolicy(customWidgetResourceControllerPolicy);
        var petsiteApplicationResourceController = new lambda.Function(this, 'petsite-application-resource-controler', {
            code: lambda.Code.fromAsset(path.join(__dirname, '/../resources/resource-controller-widget')),
            handler: 'petsite-application-resource-controler.lambda_handler',
            memorySize: 128,
            runtime: lambda.Runtime.PYTHON_3_9,
            role: customWidgetLambdaRole,
            timeout: aws_cdk_lib_1.Duration.minutes(10)
        });
        petsiteApplicationResourceController.addEnvironment("EKS_CLUSTER_NAME", cluster.clusterName);
        petsiteApplicationResourceController.addEnvironment("ECS_CLUSTER_ARNS", ecsPayForAdoptionCluster.clusterArn + "," +
            ecsPetListAdoptionCluster.clusterArn + "," + ecsPetSearchCluster.clusterArn);
        var customWidgetFunction = new lambda.Function(this, 'cloudwatch-custom-widget', {
            code: lambda.Code.fromAsset(path.join(__dirname, '/../resources/resource-controller-widget')),
            handler: 'cloudwatch-custom-widget.lambda_handler',
            memorySize: 128,
            runtime: lambda.Runtime.PYTHON_3_9,
            role: customWidgetLambdaRole,
            timeout: aws_cdk_lib_1.Duration.seconds(60)
        });
        customWidgetFunction.addEnvironment("CONTROLER_LAMBDA_ARN", petsiteApplicationResourceController.functionArn);
        customWidgetFunction.addEnvironment("EKS_CLUSTER_NAME", cluster.clusterName);
        customWidgetFunction.addEnvironment("ECS_CLUSTER_ARNS", ecsPayForAdoptionCluster.clusterArn + "," +
            ecsPetListAdoptionCluster.clusterArn + "," + ecsPetSearchCluster.clusterArn);
        var costControlDashboardBody = (0, fs_1.readFileSync)("./resources/cw_dashboard_cost_control.json", "utf-8");
        costControlDashboardBody = costControlDashboardBody.replaceAll("{{YOUR_LAMBDA_ARN}}", customWidgetFunction.functionArn);
        const petSiteCostControlDashboard = new cloudwatch.CfnDashboard(this, "PetSiteCostControlDashboard", {
            dashboardName: `PetSite_Cost_Control_Dashboard_${region}`,
            dashboardBody: costControlDashboardBody
        });
        // Creating AWS Resource Group for all the resources of stack.
        const servicesCfnGroup = new resourcegroups.CfnGroup(this, 'ServicesCfnGroup', {
            name: stackName,
            description: 'Contains all the resources deployed by Cloudformation Stack ' + stackName,
            resourceQuery: {
                type: 'CLOUDFORMATION_STACK_1_0',
            }
        });
        // Enabling CloudWatch Application Insights for Resource Group
        const servicesCfnApplication = new applicationinsights.CfnApplication(this, 'ServicesApplicationInsights', {
            resourceGroupName: servicesCfnGroup.name,
            autoConfigurationEnabled: true,
            cweMonitorEnabled: true,
            opsCenterEnabled: true,
        });
        // Adding dependency to create these resources at last
        servicesCfnGroup.node.addDependency(petSiteCostControlDashboard);
        servicesCfnApplication.node.addDependency(servicesCfnGroup);
        // Adding a Lambda function to produce the errors - manually executed
        var dynamodbQueryLambdaRole = new iam.Role(this, 'dynamodbQueryLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'manageddynamodbread', 'arn:aws:iam::aws:policy/AmazonDynamoDBReadOnlyAccess'),
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'lambdaBasicExecRoletoddb', 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole')
            ]
        });
        var dynamodbQueryFunction = new lambda.Function(this, 'dynamodb-query-function', {
            code: lambda.Code.fromAsset(path.join(__dirname, '/../resources/application-insights')),
            handler: 'dynamodb-query-function.lambda_handler',
            memorySize: 128,
            runtime: lambda.Runtime.PYTHON_3_9,
            role: dynamodbQueryLambdaRole,
            timeout: aws_cdk_lib_1.Duration.seconds(900)
        });
        dynamodbQueryFunction.addEnvironment("DYNAMODB_TABLE_NAME", dynamodb_petadoption.tableName);
        this.createOuputs(new Map(Object.entries({
            'CWServiceAccountArn': cwserviceaccount.roleArn,
            'NetworkFlowMonitorServiceAccountArn': networkFlowMonitorRole.attrArn,
            'XRayServiceAccountArn': xrayserviceaccount.roleArn,
            'OIDCProviderUrl': cluster.clusterOpenIdConnectIssuerUrl,
            'OIDCProviderArn': cluster.openIdConnectProvider.openIdConnectProviderArn,
            'PetSiteUrl': `http://${alb.loadBalancerDnsName}`,
            'DynamoDBQueryFunction': dynamodbQueryFunction.functionName
        })));
        const petAdoptionsStepFn = new stepfn_1.PetAdoptionsStepFn(this, 'StepFn');
        this.createSsmParameters(new Map(Object.entries({
            '/petstore/trafficdelaytime': "1",
            '/petstore/rumscript': " ",
            '/petstore/petadoptionsstepfnarn': petAdoptionsStepFn.stepFn.stateMachineArn,
            '/petstore/updateadoptionstatusurl': statusUpdaterService.api.url,
            '/petstore/queueurl': sqsQueue.queueUrl,
            '/petstore/snsarn': topic_petadoption.topicArn,
            '/petstore/dynamodbtablename': dynamodb_petadoption.tableName,
            '/petstore/s3bucketname': s3_observabilitypetadoptions.bucketName,
            '/petstore/searchapiurl': `http://${searchService.service.loadBalancer.loadBalancerDnsName}/api/search?`,
            '/petstore/searchimage': searchService.container.imageName,
            '/petstore/petlistadoptionsurl': `http://${listAdoptionsService.service.loadBalancer.loadBalancerDnsName}/api/adoptionlist/`,
            '/petstore/petlistadoptionsmetricsurl': `http://${listAdoptionsService.service.loadBalancer.loadBalancerDnsName}/metrics`,
            '/petstore/paymentapiurl': `http://${payForAdoptionService.service.loadBalancer.loadBalancerDnsName}/api/home/completeadoption`,
            '/petstore/payforadoptionmetricsurl': `http://${payForAdoptionService.service.loadBalancer.loadBalancerDnsName}/metrics`,
            '/petstore/cleanupadoptionsurl': `http://${payForAdoptionService.service.loadBalancer.loadBalancerDnsName}/api/home/cleanupadoptions`,
            '/petstore/petsearch-collector-manual-config': (0, fs_1.readFileSync)("./resources/collector/ecs-xray-manual.yaml", "utf8"),
            '/petstore/rdssecretarn': `${auroraCluster.secret?.secretArn}`,
            '/petstore/rdsendpoint': auroraCluster.clusterEndpoint.hostname,
            '/petstore/rds-reader-endpoint': auroraCluster.clusterReadEndpoint.hostname,
            '/petstore/stackname': stackName,
            '/petstore/petsiteurl': `http://${alb.loadBalancerDnsName}`,
            '/petstore/pethistoryurl': `http://${alb.loadBalancerDnsName}/petadoptionshistory`,
            '/eks/petsite/OIDCProviderUrl': cluster.clusterOpenIdConnectIssuerUrl,
            '/eks/petsite/OIDCProviderArn': cluster.openIdConnectProvider.openIdConnectProviderArn,
            '/petstore/errormode1': "false"
        })));
        this.createOuputs(new Map(Object.entries({
            'QueueURL': sqsQueue.queueUrl,
            'UpdateAdoptionStatusurl': statusUpdaterService.api.url,
            'SNSTopicARN': topic_petadoption.topicArn,
            'RDSServerName': auroraCluster.clusterEndpoint.hostname
        })));
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
exports.Services = Services;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzZXJ2aWNlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQywyQ0FBMEM7QUFDMUMsMkNBQTBDO0FBQzFDLDBEQUF5RDtBQUN6RCxnREFBK0M7QUFDL0MseUNBQXdDO0FBQ3hDLDBEQUF5RDtBQUN6RCwyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsZ0NBQWdDO0FBQ2hDLDZCQUE2QjtBQUM3QixpREFBaUQ7QUFDakQsZ0VBQWdFO0FBQ2hFLHlEQUF5RDtBQUN6RCwyRUFBMkU7QUFDM0UsaUVBQWlFO0FBR2pFLGtGQUEyRTtBQUMzRSw4RUFBd0U7QUFDeEUsOERBQXlEO0FBQ3pELG9GQUE4RTtBQUM5RSw4RUFBd0U7QUFDeEUsOENBQXNEO0FBRXRELDZDQUFpRztBQUNqRywyQkFBa0M7QUFDbEMsMEJBQXVCO0FBQ3ZCLCtEQUFrRjtBQUNsRixnRkFBb0U7QUFFcEUsTUFBYSxRQUFTLFNBQVEsbUJBQUs7SUFDL0IsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFrQjtRQUN4RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLFNBQVMsR0FBRyxFQUFFLENBQUM7UUFFckIsdURBQXVEO1FBQ3ZELE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDcEQsaUJBQWlCLEVBQUUsc0JBQVEsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDO1NBQzNDLENBQUMsQ0FBQztRQUVILHlEQUF5RDtRQUN6RCxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLENBQUMsQ0FBQztRQUNuRSxJQUFJLFdBQVcs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QUFHLENBQUMsZUFBZSxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsRUFBRSxhQUFhLEVBQUUsR0FBRyxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1FBQ25GLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUVPLFlBQVksQ0FBQyxNQUEyQjtRQUM1QyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxFQUFFLEdBQUcsRUFBRSxFQUFFO1lBQzFCLElBQUksdUJBQVMsQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUE7UUFDOUMsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDO0NBQ0o7QUFwcUJELDRCQW9xQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcclxuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xyXG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucydcclxuaW1wb3J0ICogYXMgc3FzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zcXMnXHJcbmltcG9ydCAqIGFzIHN1YnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucy1zdWJzY3JpcHRpb25zJ1xyXG5pbXBvcnQgKiBhcyBkZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJ1xyXG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnXHJcbmltcG9ydCAqIGFzIHMzc2VlZGVyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1kZXBsb3ltZW50J1xyXG5pbXBvcnQgKiBhcyByZHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXJkcyc7XHJcbmltcG9ydCAqIGFzIHNzbSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJztcclxuaW1wb3J0ICogYXMga21zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1rbXMnO1xyXG5pbXBvcnQgKiBhcyBla3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVrcyc7XHJcbmltcG9ydCAqIGFzIHlhbWwgZnJvbSAnanMteWFtbCc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcclxuaW1wb3J0ICogYXMgZWxidjIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNsb2FkYmFsYW5jaW5ndjInO1xyXG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoJztcclxuaW1wb3J0ICogYXMgYXBwbGljYXRpb25pbnNpZ2h0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBwbGljYXRpb25pbnNpZ2h0cyc7XHJcbmltcG9ydCAqIGFzIHJlc291cmNlZ3JvdXBzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yZXNvdXJjZWdyb3Vwcyc7XHJcblxyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJ1xyXG5pbXBvcnQgeyBQYXlGb3JBZG9wdGlvblNlcnZpY2UgfSBmcm9tICcuL3NlcnZpY2VzL3BheS1mb3ItYWRvcHRpb24tc2VydmljZSdcclxuaW1wb3J0IHsgTGlzdEFkb3B0aW9uc1NlcnZpY2UgfSBmcm9tICcuL3NlcnZpY2VzL2xpc3QtYWRvcHRpb25zLXNlcnZpY2UnXHJcbmltcG9ydCB7IFNlYXJjaFNlcnZpY2UgfSBmcm9tICcuL3NlcnZpY2VzL3NlYXJjaC1zZXJ2aWNlJ1xyXG5pbXBvcnQgeyBUcmFmZmljR2VuZXJhdG9yU2VydmljZSB9IGZyb20gJy4vc2VydmljZXMvdHJhZmZpYy1nZW5lcmF0b3Itc2VydmljZSdcclxuaW1wb3J0IHsgU3RhdHVzVXBkYXRlclNlcnZpY2UgfSBmcm9tICcuL3NlcnZpY2VzL3N0YXR1cy11cGRhdGVyLXNlcnZpY2UnXHJcbmltcG9ydCB7IFBldEFkb3B0aW9uc1N0ZXBGbiB9IGZyb20gJy4vc2VydmljZXMvc3RlcGZuJ1xyXG5pbXBvcnQgeyBLdWJlcm5ldGVzVmVyc2lvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1la3MnO1xyXG5pbXBvcnQgeyBDZm5Kc29uLCBSZW1vdmFsUG9saWN5LCBGbiwgRHVyYXRpb24sIFN0YWNrLCBTdGFja1Byb3BzLCBDZm5PdXRwdXQgfSBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IHJlYWRGaWxlU3luYyB9IGZyb20gJ2ZzJztcclxuaW1wb3J0ICd0cy1yZXBsYWNlLWFsbCdcclxuaW1wb3J0IHsgVHJlYXRNaXNzaW5nRGF0YSwgQ29tcGFyaXNvbk9wZXJhdG9yIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnO1xyXG5pbXBvcnQgeyBLdWJlY3RsVjMxTGF5ZXIgfSBmcm9tICdAYXdzLWNkay9sYW1iZGEtbGF5ZXIta3ViZWN0bC12MzEnO1xyXG5cclxuZXhwb3J0IGNsYXNzIFNlcnZpY2VzIGV4dGVuZHMgU3RhY2sge1xyXG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBTdGFja1Byb3BzKSB7XHJcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgICAgIGNvbnN0IHN0YWNrTmFtZSA9IGlkO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGUgU1FTIHJlc291cmNlIHRvIHNlbmQgUGV0IGFkb3B0aW9uIG1lc3NhZ2VzIHRvXHJcbiAgICAgICAgY29uc3Qgc3FzUXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdzcXNfcGV0YWRvcHRpb24nLCB7XHJcbiAgICAgICAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDMwMClcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIFNOUyBhbmQgYW4gZW1haWwgdG9waWMgdG8gc2VuZCBub3RpZmljYXRpb25zIHRvXHJcbiAgICAgICAgY29uc3QgdG9waWNfcGV0YWRvcHRpb24gPSBuZXcgc25zLlRvcGljKHRoaXMsICd0b3BpY19wZXRhZG9wdGlvbicpO1xyXG4gICAgICAgIHZhciB0b3BpY19lbWFpbCA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdzbnN0b3BpY19lbWFpbCcpO1xyXG4gICAgICAgIGlmICh0b3BpY19lbWFpbCA9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdG9waWNfZW1haWwgPSBcInNvbWVvbmVAZXhhbXBsZS5jb21cIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgdG9waWNfcGV0YWRvcHRpb24uYWRkU3Vic2NyaXB0aW9uKG5ldyBzdWJzLkVtYWlsU3Vic2NyaXB0aW9uKHRvcGljX2VtYWlsKSk7XHJcblxyXG4gICAgICAgIC8vIENyZWF0ZXMgYW4gUzMgYnVja2V0IHRvIHN0b3JlIHBldCBpbWFnZXNcclxuICAgICAgICBjb25zdCBzM19vYnNlcnZhYmlsaXR5cGV0YWRvcHRpb25zID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnczNidWNrZXRfcGV0YWRvcHRpb24nLCB7XHJcbiAgICAgICAgICAgIHB1YmxpY1JlYWRBY2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcclxuICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGVzIHRoZSBEeW5hbW9EQiB0YWJsZSBmb3IgUGV0YWRvcHRpb24gZGF0YVxyXG4gICAgICAgIGNvbnN0IGR5bmFtb2RiX3BldGFkb3B0aW9uID0gbmV3IGRkYi5UYWJsZSh0aGlzLCAnZGRiX3BldGFkb3B0aW9uJywge1xyXG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdwZXR0eXBlJyxcclxuICAgICAgICAgICAgICAgIHR5cGU6IGRkYi5BdHRyaWJ1dGVUeXBlLlNUUklOR1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBzb3J0S2V5OiB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAncGV0aWQnLFxyXG4gICAgICAgICAgICAgICAgdHlwZTogZGRiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBkeW5hbW9kYl9wZXRhZG9wdGlvbi5tZXRyaWMoJ1dyaXRlVGhyb3R0bGVFdmVudHMnLCB7IHN0YXRpc3RpYzogXCJhdmdcIiB9KS5jcmVhdGVBbGFybSh0aGlzLCAnV3JpdGVUaHJvdHRsZUV2ZW50cy1CYXNpY0FsYXJtJywge1xyXG4gICAgICAgICAgICB0aHJlc2hvbGQ6IDAsXHJcbiAgICAgICAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIGR5bmFtb2RiX3BldGFkb3B0aW9uLm1ldHJpYygnUmVhZFRocm90dGxlRXZlbnRzJywgeyBzdGF0aXN0aWM6IFwiYXZnXCIgfSkuY3JlYXRlQWxhcm0odGhpcywgJ1JlYWRUaHJvdHRsZUV2ZW50cy1CYXNpY0FsYXJtJywge1xyXG4gICAgICAgICAgICB0aHJlc2hvbGQ6IDAsXHJcbiAgICAgICAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXHJcbiAgICAgICAgfSk7XHJcblxyXG5cclxuICAgICAgICAvLyBTZWVkcyB0aGUgUzMgYnVja2V0IHdpdGggcGV0IGltYWdlc1xyXG4gICAgICAgIG5ldyBzM3NlZWRlci5CdWNrZXREZXBsb3ltZW50KHRoaXMsIFwiczNzZWVkZXJfcGV0YWRvcHRpb25cIiwge1xyXG4gICAgICAgICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogczNfb2JzZXJ2YWJpbGl0eXBldGFkb3B0aW9ucyxcclxuICAgICAgICAgICAgc291cmNlczogW3Mzc2VlZGVyLlNvdXJjZS5hc3NldCgnLi9yZXNvdXJjZXMva2l0dGVuLnppcCcpLCBzM3NlZWRlci5Tb3VyY2UuYXNzZXQoJy4vcmVzb3VyY2VzL3B1cHBpZXMuemlwJyksIHMzc2VlZGVyLlNvdXJjZS5hc3NldCgnLi9yZXNvdXJjZXMvYnVubmllcy56aXAnKV1cclxuICAgICAgICB9KTtcclxuXHJcblxyXG4gICAgICAgIHZhciBjaWRyUmFuZ2UgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgndnBjX2NpZHInKTtcclxuICAgICAgICBpZiAoY2lkclJhbmdlID09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICBjaWRyUmFuZ2UgPSBcIjExLjAuMC4wLzE2XCI7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vIFRoZSBWUEMgd2hlcmUgYWxsIHRoZSBtaWNyb3NlcnZpY2VzIHdpbGwgYmUgZGVwbG95ZWQgaW50b1xyXG4gICAgICAgIGNvbnN0IHRoZVZQQyA9IG5ldyBlYzIuVnBjKHRoaXMsICdNaWNyb3NlcnZpY2VzJywge1xyXG4gICAgICAgICAgICBpcEFkZHJlc3NlczogZWMyLklwQWRkcmVzc2VzLmNpZHIoY2lkclJhbmdlKSxcclxuICAgICAgICAgICAgbmF0R2F0ZXdheXM6IDEsXHJcbiAgICAgICAgICAgIG1heEF6czogMlxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBEaXNhYmxlIE1hcCBJUCBvbiBsYXVuY2ggZm9yIGFsbCBwdWJsaWMgc3VibmV0c1xyXG4gICAgICAgIGNvbnN0IHB1YmxpY1N1Ym5ldHMgPSB0aGVWUEMuc2VsZWN0U3VibmV0cyh7XHJcbiAgICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgZm9yIChjb25zdCBzdWJuZXQgb2YgcHVibGljU3VibmV0cy5zdWJuZXRzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNmblN1Ym5ldCA9IHN1Ym5ldC5ub2RlLmRlZmF1bHRDaGlsZCBhcyBlYzIuQ2ZuU3VibmV0O1xyXG4gICAgICAgICAgICBjZm5TdWJuZXQubWFwUHVibGljSXBPbkxhdW5jaCA9IGZhbHNlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIFJEUyBBdXJvcmEgUEcgY2x1c3RlclxyXG4gICAgICAgIGNvbnN0IHJkc3NlY3VyaXR5Z3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ3BldGFkb3B0aW9uc3Jkc1NHJywge1xyXG4gICAgICAgICAgICB2cGM6IHRoZVZQQ1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICByZHNzZWN1cml0eWdyb3VwLmFkZEluZ3Jlc3NSdWxlKGVjMi5QZWVyLmlwdjQodGhlVlBDLnZwY0NpZHJCbG9jayksIGVjMi5Qb3J0LnRjcCg1NDMyKSwgJ0FsbG93IEF1cm9yYSBQRyBhY2Nlc3MgZnJvbSB3aXRoaW4gdGhlIFZQQyBDSURSIHJhbmdlJyk7XHJcblxyXG4gICAgICAgIHZhciByZHNVc2VybmFtZSA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdyZHN1c2VybmFtZScpO1xyXG4gICAgICAgIGlmIChyZHNVc2VybmFtZSA9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgcmRzVXNlcm5hbWUgPSBcInBldGFkbWluXCJcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGF1cm9yYUNsdXN0ZXIgPSBuZXcgcmRzLkRhdGFiYXNlQ2x1c3Rlcih0aGlzLCAnRGF0YWJhc2UnLCB7XHJcbiAgICAgICAgICAgIGVuZ2luZTogcmRzLkRhdGFiYXNlQ2x1c3RlckVuZ2luZS5hdXJvcmFQb3N0Z3Jlcyh7IHZlcnNpb246IHJkcy5BdXJvcmFQb3N0Z3Jlc0VuZ2luZVZlcnNpb24uVkVSXzE2XzYgfSksXHJcbiAgICAgICAgICAgIHBhcmFtZXRlckdyb3VwOiByZHMuUGFyYW1ldGVyR3JvdXAuZnJvbVBhcmFtZXRlckdyb3VwTmFtZSh0aGlzLCAnUGFyYW1ldGVyR3JvdXAnLCAnZGVmYXVsdC5hdXJvcmEtcG9zdGdyZXNxbDE2JyksXHJcbiAgICAgICAgICAgIHZwYzogdGhlVlBDLFxyXG4gICAgICAgICAgICBzZWN1cml0eUdyb3VwczogW3Jkc3NlY3VyaXR5Z3JvdXBdLFxyXG4gICAgICAgICAgICBkZWZhdWx0RGF0YWJhc2VOYW1lOiAnYWRvcHRpb25zJyxcclxuICAgICAgICAgICAgZGF0YWJhc2VJbnNpZ2h0c01vZGU6IHJkcy5EYXRhYmFzZUluc2lnaHRzTW9kZS5BRFZBTkNFRCxcclxuICAgICAgICAgICAgcGVyZm9ybWFuY2VJbnNpZ2h0UmV0ZW50aW9uOiByZHMuUGVyZm9ybWFuY2VJbnNpZ2h0UmV0ZW50aW9uLk1PTlRIU18xNSxcclxuICAgICAgICAgICAgd3JpdGVyOiByZHMuQ2x1c3Rlckluc3RhbmNlLnByb3Zpc2lvbmVkKCd3cml0ZXInLCB7XHJcbiAgICAgICAgICAgICAgICBhdXRvTWlub3JWZXJzaW9uVXBncmFkZTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIGluc3RhbmNlVHlwZTogZWMyLkluc3RhbmNlVHlwZS5vZihlYzIuSW5zdGFuY2VDbGFzcy5UNEcsIGVjMi5JbnN0YW5jZVNpemUuTUVESVVNKSxcclxuICAgICAgICAgICAgfSksXHJcblxyXG4gICAgICAgICAgICByZWFkZXJzOiBbXHJcbiAgICAgICAgICAgICAgICByZHMuQ2x1c3Rlckluc3RhbmNlLnByb3Zpc2lvbmVkKCdyZWFkZXIxJywge1xyXG4gICAgICAgICAgICAgICAgICAgIHByb21vdGlvblRpZXI6IDEsXHJcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VUeXBlOiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLlQ0RywgZWMyLkluc3RhbmNlU2l6ZS5NRURJVU0pLFxyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgfSk7XHJcblxyXG5cclxuICAgICAgICBjb25zdCByZWFkU1NNUGFyYW1zUG9saWN5ID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICdzc206R2V0UGFyYW1ldGVyc0J5UGF0aCcsXHJcbiAgICAgICAgICAgICAgICAnc3NtOkdldFBhcmFtZXRlcnMnLFxyXG4gICAgICAgICAgICAgICAgJ3NzbTpHZXRQYXJhbWV0ZXInLFxyXG4gICAgICAgICAgICAgICAgJ2VjMjpEZXNjcmliZVZwY3MnXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgIHJlc291cmNlczogWycqJ11cclxuICAgICAgICB9KTtcclxuXHJcblxyXG4gICAgICAgIGNvbnN0IGRkYlNlZWRQb2xpY3kgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkJhdGNoV3JpdGVJdGVtJyxcclxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpMaXN0VGFibGVzJyxcclxuICAgICAgICAgICAgICAgIFwiZHluYW1vZGI6U2NhblwiLFxyXG4gICAgICAgICAgICAgICAgXCJkeW5hbW9kYjpRdWVyeVwiXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgIHJlc291cmNlczogWycqJ11cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgY29uc3QgcmVwb3NpdG9yeVVSSSA9IFwicHVibGljLmVjci5hd3Mvb25lLW9ic2VydmFiaWxpdHktd29ya3Nob3BcIjtcclxuXHJcbiAgICAgICAgY29uc3Qgc3RhY2sgPSBTdGFjay5vZih0aGlzKTtcclxuICAgICAgICBjb25zdCByZWdpb24gPSBzdGFjay5yZWdpb247XHJcblxyXG4gICAgICAgIGNvbnN0IGVjc1NlcnZpY2VzU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnRUNTU2VydmljZXNTRycsIHtcclxuICAgICAgICAgICAgdnBjOiB0aGVWUENcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgZWNzU2VydmljZXNTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKGVjMi5QZWVyLmlwdjQodGhlVlBDLnZwY0NpZHJCbG9jayksIGVjMi5Qb3J0LnRjcCg4MCkpO1xyXG5cclxuICAgICAgICBjb25zdCBlY3NQYXlGb3JBZG9wdGlvbkNsdXN0ZXIgPSBuZXcgZWNzLkNsdXN0ZXIodGhpcywgXCJQYXlGb3JBZG9wdGlvblwiLCB7XHJcbiAgICAgICAgICAgIHZwYzogdGhlVlBDLFxyXG4gICAgICAgICAgICBjb250YWluZXJJbnNpZ2h0c1YyOiBlY3MuQ29udGFpbmVySW5zaWdodHMuRU5IQU5DRURcclxuICAgICAgICB9KTtcclxuICAgICAgICAvLyBQYXlGb3JBZG9wdGlvbiBzZXJ2aWNlIGRlZmluaXRpb25zLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgICAgICBjb25zdCBwYXlGb3JBZG9wdGlvblNlcnZpY2UgPSBuZXcgUGF5Rm9yQWRvcHRpb25TZXJ2aWNlKHRoaXMsICdwYXktZm9yLWFkb3B0aW9uLXNlcnZpY2UnLCB7XHJcbiAgICAgICAgICAgIGNsdXN0ZXI6IGVjc1BheUZvckFkb3B0aW9uQ2x1c3RlcixcclxuICAgICAgICAgICAgbG9nR3JvdXBOYW1lOiBcIi9lY3MvUGF5Rm9yQWRvcHRpb25cIixcclxuICAgICAgICAgICAgY3B1OiAxMDI0LFxyXG4gICAgICAgICAgICBtZW1vcnlMaW1pdE1pQjogMjA0OCxcclxuICAgICAgICAgICAgaGVhbHRoQ2hlY2s6ICcvaGVhbHRoL3N0YXR1cycsXHJcbiAgICAgICAgICAgIGluc3RydW1lbnRhdGlvbjogJ290ZWwnLFxyXG4gICAgICAgICAgICBkYXRhYmFzZTogYXVyb3JhQ2x1c3RlcixcclxuICAgICAgICAgICAgZGVzaXJlZFRhc2tDb3VudDogMixcclxuICAgICAgICAgICAgcmVnaW9uOiByZWdpb24sXHJcbiAgICAgICAgICAgIHNlY3VyaXR5R3JvdXA6IGVjc1NlcnZpY2VzU2VjdXJpdHlHcm91cFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHBheUZvckFkb3B0aW9uU2VydmljZS50YXNrRGVmaW5pdGlvbi50YXNrUm9sZT8uYWRkVG9QcmluY2lwYWxQb2xpY3kocmVhZFNTTVBhcmFtc1BvbGljeSk7XHJcbiAgICAgICAgcGF5Rm9yQWRvcHRpb25TZXJ2aWNlLnRhc2tEZWZpbml0aW9uLnRhc2tSb2xlPy5hZGRUb1ByaW5jaXBhbFBvbGljeShkZGJTZWVkUG9saWN5KTtcclxuXHJcblxyXG4gICAgICAgIGNvbnN0IGVjc1BldExpc3RBZG9wdGlvbkNsdXN0ZXIgPSBuZXcgZWNzLkNsdXN0ZXIodGhpcywgXCJQZXRMaXN0QWRvcHRpb25zXCIsIHtcclxuICAgICAgICAgICAgdnBjOiB0aGVWUEMsXHJcbiAgICAgICAgICAgIGNvbnRhaW5lckluc2lnaHRzVjI6IGVjcy5Db250YWluZXJJbnNpZ2h0cy5FTkhBTkNFRFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIC8vIFBldExpc3RBZG9wdGlvbnMgc2VydmljZSBkZWZpbml0aW9ucy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAgICAgY29uc3QgbGlzdEFkb3B0aW9uc1NlcnZpY2UgPSBuZXcgTGlzdEFkb3B0aW9uc1NlcnZpY2UodGhpcywgJ2xpc3QtYWRvcHRpb25zLXNlcnZpY2UnLCB7XHJcbiAgICAgICAgICAgIGNsdXN0ZXI6IGVjc1BldExpc3RBZG9wdGlvbkNsdXN0ZXIsXHJcbiAgICAgICAgICAgIGxvZ0dyb3VwTmFtZTogXCIvZWNzL1BldExpc3RBZG9wdGlvbnNcIixcclxuICAgICAgICAgICAgY3B1OiAxMDI0LFxyXG4gICAgICAgICAgICBtZW1vcnlMaW1pdE1pQjogMjA0OCxcclxuICAgICAgICAgICAgaGVhbHRoQ2hlY2s6ICcvaGVhbHRoL3N0YXR1cycsXHJcbiAgICAgICAgICAgIGluc3RydW1lbnRhdGlvbjogJ290ZWwnLFxyXG4gICAgICAgICAgICBkYXRhYmFzZTogYXVyb3JhQ2x1c3RlcixcclxuICAgICAgICAgICAgZGVzaXJlZFRhc2tDb3VudDogMixcclxuICAgICAgICAgICAgcmVnaW9uOiByZWdpb24sXHJcbiAgICAgICAgICAgIHNlY3VyaXR5R3JvdXA6IGVjc1NlcnZpY2VzU2VjdXJpdHlHcm91cFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGxpc3RBZG9wdGlvbnNTZXJ2aWNlLnRhc2tEZWZpbml0aW9uLnRhc2tSb2xlPy5hZGRUb1ByaW5jaXBhbFBvbGljeShyZWFkU1NNUGFyYW1zUG9saWN5KTtcclxuXHJcbiAgICAgICAgY29uc3QgZWNzUGV0U2VhcmNoQ2x1c3RlciA9IG5ldyBlY3MuQ2x1c3Rlcih0aGlzLCBcIlBldFNlYXJjaFwiLCB7XHJcbiAgICAgICAgICAgIHZwYzogdGhlVlBDLFxyXG4gICAgICAgICAgICBjb250YWluZXJJbnNpZ2h0c1YyOiBlY3MuQ29udGFpbmVySW5zaWdodHMuRU5IQU5DRURcclxuICAgICAgICB9KTtcclxuICAgICAgICAvLyBQZXRTZWFyY2ggc2VydmljZSBkZWZpbml0aW9ucy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IG5ldyBTZWFyY2hTZXJ2aWNlKHRoaXMsICdzZWFyY2gtc2VydmljZScsIHtcclxuICAgICAgICAgICAgY2x1c3RlcjogZWNzUGV0U2VhcmNoQ2x1c3RlcixcclxuICAgICAgICAgICAgbG9nR3JvdXBOYW1lOiBcIi9lY3MvUGV0U2VhcmNoXCIsXHJcbiAgICAgICAgICAgIGNwdTogMTAyNCxcclxuICAgICAgICAgICAgbWVtb3J5TGltaXRNaUI6IDIwNDgsXHJcbiAgICAgICAgICAgIC8vcmVwb3NpdG9yeVVSSTogcmVwb3NpdG9yeVVSSSxcclxuICAgICAgICAgICAgaGVhbHRoQ2hlY2s6ICcvaGVhbHRoL3N0YXR1cycsXHJcbiAgICAgICAgICAgIGRlc2lyZWRUYXNrQ291bnQ6IDIsXHJcbiAgICAgICAgICAgIGluc3RydW1lbnRhdGlvbjogJ290ZWwnLFxyXG4gICAgICAgICAgICByZWdpb246IHJlZ2lvbixcclxuICAgICAgICAgICAgc2VjdXJpdHlHcm91cDogZWNzU2VydmljZXNTZWN1cml0eUdyb3VwXHJcbiAgICAgICAgfSlcclxuICAgICAgICBzZWFyY2hTZXJ2aWNlLnRhc2tEZWZpbml0aW9uLnRhc2tSb2xlPy5hZGRUb1ByaW5jaXBhbFBvbGljeShyZWFkU1NNUGFyYW1zUG9saWN5KTtcclxuXHJcbiAgICAgICAgLy8gVHJhZmZpYyBHZW5lcmF0b3IgdGFzayBkZWZpbml0aW9uLlxyXG4gICAgICAgIGNvbnN0IHRyYWZmaWNHZW5lcmF0b3JTZXJ2aWNlID0gbmV3IFRyYWZmaWNHZW5lcmF0b3JTZXJ2aWNlKHRoaXMsICd0cmFmZmljLWdlbmVyYXRvci1zZXJ2aWNlJywge1xyXG4gICAgICAgICAgICBjbHVzdGVyOiBlY3NQZXRMaXN0QWRvcHRpb25DbHVzdGVyLFxyXG4gICAgICAgICAgICBsb2dHcm91cE5hbWU6IFwiL2Vjcy9QZXRUcmFmZmljR2VuZXJhdG9yXCIsXHJcbiAgICAgICAgICAgIGNwdTogMjU2LFxyXG4gICAgICAgICAgICBtZW1vcnlMaW1pdE1pQjogNTEyLFxyXG4gICAgICAgICAgICBpbnN0cnVtZW50YXRpb246ICdub25lJyxcclxuICAgICAgICAgICAgLy9yZXBvc2l0b3J5VVJJOiByZXBvc2l0b3J5VVJJLFxyXG4gICAgICAgICAgICBkZXNpcmVkVGFza0NvdW50OiAxLFxyXG4gICAgICAgICAgICByZWdpb246IHJlZ2lvbixcclxuICAgICAgICAgICAgc2VjdXJpdHlHcm91cDogZWNzU2VydmljZXNTZWN1cml0eUdyb3VwXHJcbiAgICAgICAgfSlcclxuICAgICAgICB0cmFmZmljR2VuZXJhdG9yU2VydmljZS50YXNrRGVmaW5pdGlvbi50YXNrUm9sZT8uYWRkVG9QcmluY2lwYWxQb2xpY3kocmVhZFNTTVBhcmFtc1BvbGljeSk7XHJcblxyXG4gICAgICAgIC8vUGV0U3RhdHVzVXBkYXRlciBMYW1iZGEgRnVuY3Rpb24gYW5kIEFQSUdXLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgICAgICBjb25zdCBzdGF0dXNVcGRhdGVyU2VydmljZSA9IG5ldyBTdGF0dXNVcGRhdGVyU2VydmljZSh0aGlzLCAnc3RhdHVzLXVwZGF0ZXItc2VydmljZScsIHtcclxuICAgICAgICAgICAgdGFibGVOYW1lOiBkeW5hbW9kYl9wZXRhZG9wdGlvbi50YWJsZU5hbWVcclxuICAgICAgICB9KTtcclxuXHJcblxyXG4gICAgICAgIGNvbnN0IGFsYlNHID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdBTEJTZWN1cml0eUdyb3VwJywge1xyXG4gICAgICAgICAgICB2cGM6IHRoZVZQQyxcclxuICAgICAgICAgICAgc2VjdXJpdHlHcm91cE5hbWU6ICdBTEJTZWN1cml0eUdyb3VwJyxcclxuICAgICAgICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGFsYlNHLmFkZEluZ3Jlc3NSdWxlKGVjMi5QZWVyLmFueUlwdjQoKSwgZWMyLlBvcnQudGNwKDgwKSk7XHJcblxyXG4gICAgICAgIC8vIFBldFNpdGUgLSBDcmVhdGUgQUxCIGFuZCBUYXJnZXQgR3JvdXBzXHJcbiAgICAgICAgY29uc3QgYWxiID0gbmV3IGVsYnYyLkFwcGxpY2F0aW9uTG9hZEJhbGFuY2VyKHRoaXMsICdQZXRTaXRlTG9hZEJhbGFuY2VyJywge1xyXG4gICAgICAgICAgICB2cGM6IHRoZVZQQyxcclxuICAgICAgICAgICAgaW50ZXJuZXRGYWNpbmc6IHRydWUsXHJcbiAgICAgICAgICAgIHNlY3VyaXR5R3JvdXA6IGFsYlNHXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgdHJhZmZpY0dlbmVyYXRvclNlcnZpY2Uubm9kZS5hZGREZXBlbmRlbmN5KGFsYik7XHJcblxyXG4gICAgICAgIGNvbnN0IHRhcmdldEdyb3VwID0gbmV3IGVsYnYyLkFwcGxpY2F0aW9uVGFyZ2V0R3JvdXAodGhpcywgJ1BldFNpdGVUYXJnZXRHcm91cCcsIHtcclxuICAgICAgICAgICAgcG9ydDogODAsXHJcbiAgICAgICAgICAgIHByb3RvY29sOiBlbGJ2Mi5BcHBsaWNhdGlvblByb3RvY29sLkhUVFAsXHJcbiAgICAgICAgICAgIHZwYzogdGhlVlBDLFxyXG4gICAgICAgICAgICB0YXJnZXRUeXBlOiBlbGJ2Mi5UYXJnZXRUeXBlLklQXHJcblxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCBcInB1dFBhcmFtVGFyZ2V0R3JvdXBBcm5cIiwge1xyXG4gICAgICAgICAgICBzdHJpbmdWYWx1ZTogdGFyZ2V0R3JvdXAudGFyZ2V0R3JvdXBBcm4sXHJcbiAgICAgICAgICAgIHBhcmFtZXRlck5hbWU6ICcvZWtzL3BldHNpdGUvVGFyZ2V0R3JvdXBBcm4nXHJcbiAgICAgICAgfSlcclxuXHJcbiAgICAgICAgY29uc3QgbGlzdGVuZXIgPSBhbGIuYWRkTGlzdGVuZXIoJ0xpc3RlbmVyJywge1xyXG4gICAgICAgICAgICBwb3J0OiA4MCxcclxuICAgICAgICAgICAgb3BlbjogdHJ1ZSxcclxuICAgICAgICAgICAgZGVmYXVsdFRhcmdldEdyb3VwczogW3RhcmdldEdyb3VwXSxcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gUGV0QWRvcHRpb25IaXN0b3J5IC0gYXR0YWNoIHNlcnZpY2UgdG8gcGF0aCAvcGV0YWRvcHRpb25oaXN0b3J5IG9uIFBldFNpdGUgQUxCXHJcbiAgICAgICAgY29uc3QgcGV0YWRvcHRpb25zaGlzdG9yeV90YXJnZXRHcm91cCA9IG5ldyBlbGJ2Mi5BcHBsaWNhdGlvblRhcmdldEdyb3VwKHRoaXMsICdQZXRBZG9wdGlvbnNIaXN0b3J5VGFyZ2V0R3JvdXAnLCB7XHJcbiAgICAgICAgICAgIHBvcnQ6IDgwLFxyXG4gICAgICAgICAgICBwcm90b2NvbDogZWxidjIuQXBwbGljYXRpb25Qcm90b2NvbC5IVFRQLFxyXG4gICAgICAgICAgICB2cGM6IHRoZVZQQyxcclxuICAgICAgICAgICAgdGFyZ2V0VHlwZTogZWxidjIuVGFyZ2V0VHlwZS5JUCxcclxuICAgICAgICAgICAgaGVhbHRoQ2hlY2s6IHtcclxuICAgICAgICAgICAgICAgIHBhdGg6ICcvaGVhbHRoL3N0YXR1cycsXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgbGlzdGVuZXIuYWRkVGFyZ2V0R3JvdXBzKCdQZXRBZG9wdGlvbnNIaXN0b3J5VGFyZ2V0R3JvdXBzJywge1xyXG4gICAgICAgICAgICBwcmlvcml0eTogMTAsXHJcbiAgICAgICAgICAgIGNvbmRpdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgIGVsYnYyLkxpc3RlbmVyQ29uZGl0aW9uLnBhdGhQYXR0ZXJucyhbJy9wZXRhZG9wdGlvbnNoaXN0b3J5LyonXSksXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgIHRhcmdldEdyb3VwczogW3BldGFkb3B0aW9uc2hpc3RvcnlfdGFyZ2V0R3JvdXBdXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsIFwicHV0UGV0SGlzdG9yeVBhcmFtVGFyZ2V0R3JvdXBBcm5cIiwge1xyXG4gICAgICAgICAgICBzdHJpbmdWYWx1ZTogcGV0YWRvcHRpb25zaGlzdG9yeV90YXJnZXRHcm91cC50YXJnZXRHcm91cEFybixcclxuICAgICAgICAgICAgcGFyYW1ldGVyTmFtZTogJy9la3MvcGV0aGlzdG9yeS9UYXJnZXRHcm91cEFybidcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gUGV0U2l0ZSAtIEVLUyBDbHVzdGVyXHJcbiAgICAgICAgY29uc3QgY2x1c3RlckFkbWluID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdBZG1pblJvbGUnLCB7XHJcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5BY2NvdW50Um9vdFByaW5jaXBhbCgpXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsIFwicHV0UGFyYW1cIiwge1xyXG4gICAgICAgICAgICBzdHJpbmdWYWx1ZTogY2x1c3RlckFkbWluLnJvbGVBcm4sXHJcbiAgICAgICAgICAgIHBhcmFtZXRlck5hbWU6ICcvZWtzL3BldHNpdGUvRUtTTWFzdGVyUm9sZUFybidcclxuICAgICAgICB9KVxyXG5cclxuICAgICAgICBjb25zdCBzZWNyZXRzS2V5ID0gbmV3IGttcy5LZXkodGhpcywgJ1NlY3JldHNLZXknKTtcclxuICAgICAgICBjb25zdCBjbHVzdGVyID0gbmV3IGVrcy5DbHVzdGVyKHRoaXMsICdwZXRzaXRlJywge1xyXG4gICAgICAgICAgICBjbHVzdGVyTmFtZTogJ1BldFNpdGUnLFxyXG4gICAgICAgICAgICBtYXN0ZXJzUm9sZTogY2x1c3RlckFkbWluLFxyXG4gICAgICAgICAgICB2cGM6IHRoZVZQQyxcclxuICAgICAgICAgICAgZGVmYXVsdENhcGFjaXR5OiAyLFxyXG4gICAgICAgICAgICBkZWZhdWx0Q2FwYWNpdHlJbnN0YW5jZTogZWMyLkluc3RhbmNlVHlwZS5vZihlYzIuSW5zdGFuY2VDbGFzcy5UMywgZWMyLkluc3RhbmNlU2l6ZS5NRURJVU0pLFxyXG4gICAgICAgICAgICBzZWNyZXRzRW5jcnlwdGlvbktleTogc2VjcmV0c0tleSxcclxuICAgICAgICAgICAgdmVyc2lvbjogZWtzLkt1YmVybmV0ZXNWZXJzaW9uLlYxXzMxLFxyXG4gICAgICAgICAgICBrdWJlY3RsTGF5ZXI6IG5ldyBLdWJlY3RsVjMxTGF5ZXIodGhpcywgJ2t1YmVjdGwnKSxcclxuICAgICAgICAgICAgYXV0aGVudGljYXRpb25Nb2RlOiBla3MuQXV0aGVudGljYXRpb25Nb2RlLkFQSV9BTkRfQ09ORklHX01BUCxcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgY29uc3QgY2x1c3RlclNHID0gZWMyLlNlY3VyaXR5R3JvdXAuZnJvbVNlY3VyaXR5R3JvdXBJZCh0aGlzLCAnQ2x1c3RlclNHJywgY2x1c3Rlci5jbHVzdGVyU2VjdXJpdHlHcm91cElkKTtcclxuICAgICAgICBjbHVzdGVyU0cuYWRkSW5ncmVzc1J1bGUoYWxiU0csIGVjMi5Qb3J0LmFsbFRyYWZmaWMoKSwgJ0FsbG93IHRyYWZmaWMgZnJvbSB0aGUgQUxCJyk7XHJcbiAgICAgICAgY2x1c3RlclNHLmFkZEluZ3Jlc3NSdWxlKGVjMi5QZWVyLmlwdjQodGhlVlBDLnZwY0NpZHJCbG9jayksIGVjMi5Qb3J0LnRjcCg0NDMpLCAnQWxsb3cgbG9jYWwgYWNjZXNzIHRvIGs4cyBhcGknKTtcclxuXHJcblxyXG4gICAgICAgIC8vIEFkZCBTU00gUGVybWlzc2lvbnMgdG8gdGhlIG5vZGUgcm9sZVxyXG4gICAgICAgIGNsdXN0ZXIuZGVmYXVsdE5vZGVncm91cD8ucm9sZS5hZGRNYW5hZ2VkUG9saWN5KGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcIkFtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmVcIikpO1xyXG5cclxuICAgICAgICAvLyBGcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3Mtc2FtcGxlcy9zc20tYWdlbnQtZGFlbW9uc2V0LWluc3RhbGxlclxyXG4gICAgICAgIHZhciBzc21BZ2VudFNldHVwID0geWFtbC5sb2FkQWxsKHJlYWRGaWxlU3luYyhcIi4vcmVzb3VyY2VzL3NldHVwLXNzbS1hZ2VudC55YW1sXCIsIFwidXRmOFwiKSkgYXMgUmVjb3JkPHN0cmluZywgYW55PltdO1xyXG5cclxuICAgICAgICBjb25zdCBzc21BZ2VudFNldHVwTWFuaWZlc3QgPSBuZXcgZWtzLkt1YmVybmV0ZXNNYW5pZmVzdCh0aGlzLCBcInNzbUFnZW50ZGVwbG95bWVudFwiLCB7XHJcbiAgICAgICAgICAgIGNsdXN0ZXI6IGNsdXN0ZXIsXHJcbiAgICAgICAgICAgIG1hbmlmZXN0OiBzc21BZ2VudFNldHVwXHJcbiAgICAgICAgfSk7XHJcblxyXG5cclxuXHJcbiAgICAgICAgLy8gQ2x1c3RlcklEIGlzIG5vdCBhdmFpbGFibGUgZm9yIGNyZWF0aW5nIHRoZSBwcm9wZXIgY29uZGl0aW9ucyBodHRwczovL2dpdGh1Yi5jb20vYXdzL2F3cy1jZGsvaXNzdWVzLzEwMzQ3XHJcbiAgICAgICAgY29uc3QgY2x1c3RlcklkID0gRm4uc2VsZWN0KDQsIEZuLnNwbGl0KCcvJywgY2x1c3Rlci5jbHVzdGVyT3BlbklkQ29ubmVjdElzc3VlclVybCkpIC8vIFJlbW92ZSBodHRwczovLyBmcm9tIHRoZSBVUkwgYXMgd29ya2Fyb3VuZCB0byBnZXQgQ2x1c3RlcklEXHJcblxyXG4gICAgICAgIGNvbnN0IGN3X2ZlZGVyYXRlZFByaW5jaXBhbCA9IG5ldyBpYW0uRmVkZXJhdGVkUHJpbmNpcGFsKFxyXG4gICAgICAgICAgICBjbHVzdGVyLm9wZW5JZENvbm5lY3RQcm92aWRlci5vcGVuSWRDb25uZWN0UHJvdmlkZXJBcm4sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIFN0cmluZ0VxdWFsczogbmV3IENmbkpzb24odGhpcywgXCJDV19GZWRlcmF0ZWRQcmluY2lwYWxDb25kaXRpb25cIiwge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFtgb2lkYy5la3MuJHtyZWdpb259LmFtYXpvbmF3cy5jb20vaWQvJHtjbHVzdGVySWR9OmF1ZGBdOiBcInN0cy5hbWF6b25hd3MuY29tXCJcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuICAgICAgICBjb25zdCBjd190cnVzdFJlbGF0aW9uc2hpcCA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICBwcmluY2lwYWxzOiBbY3dfZmVkZXJhdGVkUHJpbmNpcGFsXSxcclxuICAgICAgICAgICAgYWN0aW9uczogW1wic3RzOkFzc3VtZVJvbGVXaXRoV2ViSWRlbnRpdHlcIl1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIElBTSByb2xlcyBmb3IgU2VydmljZSBBY2NvdW50c1xyXG4gICAgICAgIC8vIENsb3Vkd2F0Y2ggQWdlbnQgU0FcclxuICAgICAgICBjb25zdCBjd3NlcnZpY2VhY2NvdW50ID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdDV1NlcnZpY2VBY2NvdW50Jywge1xyXG4gICAgICAgICAgICAvLyAgICAgICAgICAgICAgICBhc3N1bWVkQnk6IGVrc0ZlZGVyYXRlZFByaW5jaXBhbCxcclxuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkFjY291bnRSb290UHJpbmNpcGFsKCksXHJcbiAgICAgICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4odGhpcywgJ0NXU2VydmljZUFjY291bnQtQ2xvdWRXYXRjaEFnZW50U2VydmVyUG9saWN5JywgJ2Fybjphd3M6aWFtOjphd3M6cG9saWN5L0Nsb3VkV2F0Y2hBZ2VudFNlcnZlclBvbGljeScpXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY3dzZXJ2aWNlYWNjb3VudC5hc3N1bWVSb2xlUG9saWN5Py5hZGRTdGF0ZW1lbnRzKGN3X3RydXN0UmVsYXRpb25zaGlwKTtcclxuXHJcbiAgICAgICAgY29uc3QgeHJheV9mZWRlcmF0ZWRQcmluY2lwYWwgPSBuZXcgaWFtLkZlZGVyYXRlZFByaW5jaXBhbChcclxuICAgICAgICAgICAgY2x1c3Rlci5vcGVuSWRDb25uZWN0UHJvdmlkZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyQXJuLFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBTdHJpbmdFcXVhbHM6IG5ldyBDZm5Kc29uKHRoaXMsIFwiWHJheV9GZWRlcmF0ZWRQcmluY2lwYWxDb25kaXRpb25cIiwge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFtgb2lkYy5la3MuJHtyZWdpb259LmFtYXpvbmF3cy5jb20vaWQvJHtjbHVzdGVySWR9OmF1ZGBdOiBcInN0cy5hbWF6b25hd3MuY29tXCJcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuICAgICAgICBjb25zdCB4cmF5X3RydXN0UmVsYXRpb25zaGlwID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgIHByaW5jaXBhbHM6IFt4cmF5X2ZlZGVyYXRlZFByaW5jaXBhbF0sXHJcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcInN0czpBc3N1bWVSb2xlV2l0aFdlYklkZW50aXR5XCJdXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIFgtUmF5IEFnZW50IFNBXHJcbiAgICAgICAgY29uc3QgeHJheXNlcnZpY2VhY2NvdW50ID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdYUmF5U2VydmljZUFjY291bnQnLCB7XHJcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgICAgIGFzc3VtZWRCeTogZWtzRmVkZXJhdGVkUHJpbmNpcGFsLFxyXG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQWNjb3VudFJvb3RQcmluY2lwYWwoKSxcclxuICAgICAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tTWFuYWdlZFBvbGljeUFybih0aGlzLCAnWFJheVNlcnZpY2VBY2NvdW50LUFXU1hSYXlEYWVtb25Xcml0ZUFjY2VzcycsICdhcm46YXdzOmlhbTo6YXdzOnBvbGljeS9BV1NYUmF5RGFlbW9uV3JpdGVBY2Nlc3MnKVxyXG4gICAgICAgICAgICBdLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHhyYXlzZXJ2aWNlYWNjb3VudC5hc3N1bWVSb2xlUG9saWN5Py5hZGRTdGF0ZW1lbnRzKHhyYXlfdHJ1c3RSZWxhdGlvbnNoaXApO1xyXG5cclxuICAgICAgICBjb25zdCBsb2FkYmFsYW5jZXJfZmVkZXJhdGVkUHJpbmNpcGFsID0gbmV3IGlhbS5GZWRlcmF0ZWRQcmluY2lwYWwoXHJcbiAgICAgICAgICAgIGNsdXN0ZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyLm9wZW5JZENvbm5lY3RQcm92aWRlckFybixcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgU3RyaW5nRXF1YWxzOiBuZXcgQ2ZuSnNvbih0aGlzLCBcIkxCX0ZlZGVyYXRlZFByaW5jaXBhbENvbmRpdGlvblwiLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgW2BvaWRjLmVrcy4ke3JlZ2lvbn0uYW1hem9uYXdzLmNvbS9pZC8ke2NsdXN0ZXJJZH06YXVkYF06IFwic3RzLmFtYXpvbmF3cy5jb21cIlxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICApO1xyXG4gICAgICAgIGNvbnN0IGxvYWRCYWxhbmNlcl90cnVzdFJlbGF0aW9uc2hpcCA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICBwcmluY2lwYWxzOiBbbG9hZGJhbGFuY2VyX2ZlZGVyYXRlZFByaW5jaXBhbF0sXHJcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcInN0czpBc3N1bWVSb2xlV2l0aFdlYklkZW50aXR5XCJdXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIGNvbnN0IGxvYWRCYWxhbmNlclBvbGljeURvYyA9IGlhbS5Qb2xpY3lEb2N1bWVudC5mcm9tSnNvbihKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhcIi4vcmVzb3VyY2VzL2xvYWRfYmFsYW5jZXIvaWFtX3BvbGljeS5qc29uXCIsIFwidXRmOFwiKSkpO1xyXG4gICAgICAgIGNvbnN0IGxvYWRCYWxhbmNlclBvbGljeSA9IG5ldyBpYW0uTWFuYWdlZFBvbGljeSh0aGlzLCAnTG9hZEJhbGFuY2VyU0FQb2xpY3knLCB7IGRvY3VtZW50OiBsb2FkQmFsYW5jZXJQb2xpY3lEb2MgfSk7XHJcbiAgICAgICAgY29uc3QgbG9hZEJhbGFuY2Vyc2VydmljZWFjY291bnQgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0xvYWRCYWxhbmNlclNlcnZpY2VBY2NvdW50Jywge1xyXG4gICAgICAgICAgICAvLyAgICAgICAgICAgICAgICBhc3N1bWVkQnk6IGVrc0ZlZGVyYXRlZFByaW5jaXBhbCxcclxuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkFjY291bnRSb290UHJpbmNpcGFsKCksXHJcbiAgICAgICAgICAgIG1hbmFnZWRQb2xpY2llczogW2xvYWRCYWxhbmNlclBvbGljeV1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgbG9hZEJhbGFuY2Vyc2VydmljZWFjY291bnQuYXNzdW1lUm9sZVBvbGljeT8uYWRkU3RhdGVtZW50cyhsb2FkQmFsYW5jZXJfdHJ1c3RSZWxhdGlvbnNoaXApO1xyXG5cclxuICAgICAgICBjb25zdCBla3NBZG1pbkFybiA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdhZG1pbl9yb2xlJyk7XHJcbiAgICAgICAgaWYgKChla3NBZG1pbkFybiAhPSB1bmRlZmluZWQpICYmIChla3NBZG1pbkFybi5sZW5ndGggPiAwKSkge1xyXG4gICAgICAgICAgICBjb25zdCBhZG1pblJvbGUgPSBpYW0uUm9sZS5mcm9tUm9sZUFybih0aGlzLCBcImVrZEFkbWluUm9sZUFyblwiLCBla3NBZG1pbkFybiwgeyBtdXRhYmxlOiBmYWxzZSB9KTtcclxuICAgICAgICAgICAgY2x1c3Rlci5ncmFudEFjY2VzcygnVGVhbVJvbGVBY2Nlc3MnLCBhZG1pblJvbGUucm9sZUFybiwgW1xyXG4gICAgICAgICAgICAgICAgZWtzLkFjY2Vzc1BvbGljeS5mcm9tQWNjZXNzUG9saWN5TmFtZSgnQW1hem9uRUtTQ2x1c3RlckFkbWluUG9saWN5Jywge1xyXG4gICAgICAgICAgICAgICAgICAgIGFjY2Vzc1Njb3BlVHlwZTogZWtzLkFjY2Vzc1Njb3BlVHlwZS5DTFVTVEVSXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICBdKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHZhciB4UmF5WWFtbCA9IHlhbWwubG9hZEFsbChyZWFkRmlsZVN5bmMoXCIuL3Jlc291cmNlcy9rOHNfcGV0c2l0ZS94cmF5LWRhZW1vbi1jb25maWcueWFtbFwiLCBcInV0ZjhcIikpIGFzIFJlY29yZDxzdHJpbmcsIGFueT5bXTtcclxuXHJcbiAgICAgICAgeFJheVlhbWxbMF0ubWV0YWRhdGEuYW5ub3RhdGlvbnNbXCJla3MuYW1hem9uYXdzLmNvbS9yb2xlLWFyblwiXSA9IG5ldyBDZm5Kc29uKHRoaXMsIFwieHJheV9Sb2xlXCIsIHsgdmFsdWU6IGAke3hyYXlzZXJ2aWNlYWNjb3VudC5yb2xlQXJufWAgfSk7XHJcblxyXG4gICAgICAgIGNvbnN0IHhyYXlNYW5pZmVzdCA9IG5ldyBla3MuS3ViZXJuZXRlc01hbmlmZXN0KHRoaXMsIFwieHJheWRlcGxveW1lbnRcIiwge1xyXG4gICAgICAgICAgICBjbHVzdGVyOiBjbHVzdGVyLFxyXG4gICAgICAgICAgICBtYW5pZmVzdDogeFJheVlhbWxcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgdmFyIGxvYWRCYWxhbmNlclNlcnZpY2VBY2NvdW50WWFtbCA9IHlhbWwubG9hZEFsbChyZWFkRmlsZVN5bmMoXCIuL3Jlc291cmNlcy9sb2FkX2JhbGFuY2VyL3NlcnZpY2VfYWNjb3VudC55YW1sXCIsIFwidXRmOFwiKSkgYXMgUmVjb3JkPHN0cmluZywgYW55PltdO1xyXG4gICAgICAgIGxvYWRCYWxhbmNlclNlcnZpY2VBY2NvdW50WWFtbFswXS5tZXRhZGF0YS5hbm5vdGF0aW9uc1tcImVrcy5hbWF6b25hd3MuY29tL3JvbGUtYXJuXCJdID0gbmV3IENmbkpzb24odGhpcywgXCJsb2FkQmFsYW5jZXJfUm9sZVwiLCB7IHZhbHVlOiBgJHtsb2FkQmFsYW5jZXJzZXJ2aWNlYWNjb3VudC5yb2xlQXJufWAgfSk7XHJcblxyXG4gICAgICAgIGNvbnN0IGxvYWRCYWxhbmNlclNlcnZpY2VBY2NvdW50ID0gbmV3IGVrcy5LdWJlcm5ldGVzTWFuaWZlc3QodGhpcywgXCJsb2FkQmFsYW5jZXJTZXJ2aWNlQWNjb3VudFwiLCB7XHJcbiAgICAgICAgICAgIGNsdXN0ZXI6IGNsdXN0ZXIsXHJcbiAgICAgICAgICAgIG1hbmlmZXN0OiBsb2FkQmFsYW5jZXJTZXJ2aWNlQWNjb3VudFlhbWxcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgY29uc3Qgd2FpdEZvckxCU2VydmljZUFjY291bnQgPSBuZXcgZWtzLkt1YmVybmV0ZXNPYmplY3RWYWx1ZSh0aGlzLCAnTEJTZXJ2aWNlQWNjb3VudCcsIHtcclxuICAgICAgICAgICAgY2x1c3RlcjogY2x1c3RlcixcclxuICAgICAgICAgICAgb2JqZWN0TmFtZTogXCJhbGItaW5ncmVzcy1jb250cm9sbGVyXCIsXHJcbiAgICAgICAgICAgIG9iamVjdFR5cGU6IFwic2VydmljZWFjY291bnRcIixcclxuICAgICAgICAgICAgb2JqZWN0TmFtZXNwYWNlOiBcImt1YmUtc3lzdGVtXCIsXHJcbiAgICAgICAgICAgIGpzb25QYXRoOiBcIkBcIlxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBjb25zdCBsb2FkQmFsYW5jZXJDUkRZYW1sID0geWFtbC5sb2FkQWxsKHJlYWRGaWxlU3luYyhcIi4vcmVzb3VyY2VzL2xvYWRfYmFsYW5jZXIvY3Jkcy55YW1sXCIsIFwidXRmOFwiKSkgYXMgUmVjb3JkPHN0cmluZywgYW55PltdO1xyXG4gICAgICAgIGNvbnN0IGxvYWRCYWxhbmNlckNSRE1hbmlmZXN0ID0gbmV3IGVrcy5LdWJlcm5ldGVzTWFuaWZlc3QodGhpcywgXCJsb2FkQmFsYW5jZXJDUkRcIiwge1xyXG4gICAgICAgICAgICBjbHVzdGVyOiBjbHVzdGVyLFxyXG4gICAgICAgICAgICBtYW5pZmVzdDogbG9hZEJhbGFuY2VyQ1JEWWFtbFxyXG4gICAgICAgIH0pO1xyXG5cclxuXHJcbiAgICAgICAgY29uc3QgYXdzTG9hZEJhbGFuY2VyTWFuaWZlc3QgPSBuZXcgZWtzLkhlbG1DaGFydCh0aGlzLCBcIkFXU0xvYWRCYWxhbmNlckNvbnRyb2xsZXJcIiwge1xyXG4gICAgICAgICAgICBjbHVzdGVyOiBjbHVzdGVyLFxyXG4gICAgICAgICAgICBjaGFydDogXCJhd3MtbG9hZC1iYWxhbmNlci1jb250cm9sbGVyXCIsXHJcbiAgICAgICAgICAgIHJlcG9zaXRvcnk6IFwiaHR0cHM6Ly9hd3MuZ2l0aHViLmlvL2Vrcy1jaGFydHNcIixcclxuICAgICAgICAgICAgbmFtZXNwYWNlOiBcImt1YmUtc3lzdGVtXCIsXHJcbiAgICAgICAgICAgIHZhbHVlczoge1xyXG4gICAgICAgICAgICAgICAgY2x1c3Rlck5hbWU6IFwiUGV0U2l0ZVwiLFxyXG4gICAgICAgICAgICAgICAgc2VydmljZUFjY291bnQ6IHtcclxuICAgICAgICAgICAgICAgICAgICBjcmVhdGU6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IFwiYWxiLWluZ3Jlc3MtY29udHJvbGxlclwiXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgd2FpdDogdHJ1ZVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgYXdzTG9hZEJhbGFuY2VyTWFuaWZlc3Qubm9kZS5hZGREZXBlbmRlbmN5KGxvYWRCYWxhbmNlckNSRE1hbmlmZXN0KTtcclxuICAgICAgICBhd3NMb2FkQmFsYW5jZXJNYW5pZmVzdC5ub2RlLmFkZERlcGVuZGVuY3kobG9hZEJhbGFuY2VyU2VydmljZUFjY291bnQpO1xyXG4gICAgICAgIGF3c0xvYWRCYWxhbmNlck1hbmlmZXN0Lm5vZGUuYWRkRGVwZW5kZW5jeSh3YWl0Rm9yTEJTZXJ2aWNlQWNjb3VudCk7XHJcblxyXG5cclxuICAgICAgICAvLyBOT1RFOiBBbWF6b24gQ2xvdWRXYXRjaCBPYnNlcnZhYmlsaXR5IEFkZG9uIGZvciBDbG91ZFdhdGNoIEFnZW50IGFuZCBGbHVlbnRiaXRcclxuICAgICAgICBjb25zdCBvdGVsQWRkb24gPSBuZXcgZWtzLkNmbkFkZG9uKHRoaXMsICdvdGVsT2JzZXJ2YWJpbGl0eUFkZG9uJywge1xyXG4gICAgICAgICAgICBhZGRvbk5hbWU6ICdhbWF6b24tY2xvdWR3YXRjaC1vYnNlcnZhYmlsaXR5JyxcclxuICAgICAgICAgICAgYWRkb25WZXJzaW9uOiAndjQuNC4wLWVrc2J1aWxkLjEnLFxyXG4gICAgICAgICAgICBjbHVzdGVyTmFtZTogY2x1c3Rlci5jbHVzdGVyTmFtZSxcclxuICAgICAgICAgICAgLy8gdGhlIHByb3BlcnRpZXMgYmVsb3cgYXJlIG9wdGlvbmFsXHJcbiAgICAgICAgICAgIHJlc29sdmVDb25mbGljdHM6ICdPVkVSV1JJVEUnLFxyXG4gICAgICAgICAgICBwcmVzZXJ2ZU9uRGVsZXRlOiBmYWxzZSxcclxuICAgICAgICAgICAgc2VydmljZUFjY291bnRSb2xlQXJuOiBjd3NlcnZpY2VhY2NvdW50LnJvbGVBcm4sXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIElBTSBSb2xlIGZvciBOZXR3b3JrIEZsb3cgTW9uaXRvclxyXG4gICAgICAgIGNvbnN0IG5ldHdvcmtGbG93TW9uaXRvclJvbGUgPSBuZXcgaWFtLkNmblJvbGUodGhpcywgJ05ldHdvcmtGbG93TW9uaXRvclJvbGUnLCB7XHJcbiAgICAgICAgICAgIGFzc3VtZVJvbGVQb2xpY3lEb2N1bWVudDoge1xyXG4gICAgICAgICAgICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxyXG4gICAgICAgICAgICAgICAgU3RhdGVtZW50OiBbXHJcbiAgICAgICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFByaW5jaXBhbDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgU2VydmljZTogJ3BvZHMuZWtzLmFtYXpvbmF3cy5jb20nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBBY3Rpb246IFtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdzdHM6QXNzdW1lUm9sZScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnc3RzOlRhZ1Nlc3Npb24nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBtYW5hZ2VkUG9saWN5QXJuczogW1xyXG4gICAgICAgICAgICAgICAgJ2Fybjphd3M6aWFtOjphd3M6cG9saWN5L0Nsb3VkV2F0Y2hOZXR3b3JrRmxvd01vbml0b3JBZ2VudFB1Ymxpc2hQb2xpY3knLFxyXG4gICAgICAgICAgICBdLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBBbWF6b24gRUtTIFBvZCBJZGVudGl0eSBBZ2VudCBBZGRvbiBmb3IgTmV0d29yayBGbG93IE1vbml0b3JcclxuICAgICAgICBjb25zdCBwb2RJZGVudGl0eUFnZW50QWRkb24gPSBuZXcgZWtzLkNmbkFkZG9uKHRoaXMsICdQb2RJZGVudGl0eUFnZW50QWRkb24nLCB7XHJcbiAgICAgICAgICAgIGFkZG9uTmFtZTogJ2Vrcy1wb2QtaWRlbnRpdHktYWdlbnQnLFxyXG4gICAgICAgICAgICBhZGRvblZlcnNpb246ICd2MS4zLjQtZWtzYnVpbGQuMScsXHJcbiAgICAgICAgICAgIGNsdXN0ZXJOYW1lOiBjbHVzdGVyLmNsdXN0ZXJOYW1lLFxyXG4gICAgICAgICAgICByZXNvbHZlQ29uZmxpY3RzOiAnT1ZFUldSSVRFJyxcclxuICAgICAgICAgICAgcHJlc2VydmVPbkRlbGV0ZTogZmFsc2UsXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIEFtYXpvbiBFS1MgQVdTIE5ldHdvcmsgRmxvdyBNb25pdG9yIEFnZW50IGFkZC1vblxyXG4gICAgICAgIGNvbnN0IG5ldHdvcmtGbG93TW9uaXRvcmluZ0FnZW50QWRkb24gPSBuZXcgZWtzLkNmbkFkZG9uKHRoaXMsICdOZXR3b3JrRmxvd01vbml0b3JpbmdBZ2VudEFkZG9uJywge1xyXG4gICAgICAgICAgICBhZGRvbk5hbWU6ICdhd3MtbmV0d29yay1mbG93LW1vbml0b3JpbmctYWdlbnQnLFxyXG4gICAgICAgICAgICBhZGRvblZlcnNpb246ICd2MS4wLjEtZWtzYnVpbGQuMicsXHJcbiAgICAgICAgICAgIGNsdXN0ZXJOYW1lOiBjbHVzdGVyLmNsdXN0ZXJOYW1lLFxyXG4gICAgICAgICAgICByZXNvbHZlQ29uZmxpY3RzOiAnT1ZFUldSSVRFJyxcclxuICAgICAgICAgICAgcHJlc2VydmVPbkRlbGV0ZTogZmFsc2UsXHJcbiAgICAgICAgICAgIHBvZElkZW50aXR5QXNzb2NpYXRpb25zOiBbXHJcbiAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICAgICAgcm9sZUFybjogbmV0d29ya0Zsb3dNb25pdG9yUm9sZS5hdHRyQXJuLFxyXG4gICAgICAgICAgICAgICAgICAgIHNlcnZpY2VBY2NvdW50OiAnYXdzLW5ldHdvcmstZmxvdy1tb25pdG9yLWFnZW50LXNlcnZpY2UtYWNjb3VudCcsXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBdLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBjb25zdCBjdXN0b21XaWRnZXRSZXNvdXJjZUNvbnRyb2xsZXJQb2xpY3kgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgJ2VjczpMaXN0U2VydmljZXMnLFxyXG4gICAgICAgICAgICAgICAgJ2VjczpVcGRhdGVTZXJ2aWNlJyxcclxuICAgICAgICAgICAgICAgICdla3M6RGVzY3JpYmVOb2RlZ3JvdXAnLFxyXG4gICAgICAgICAgICAgICAgJ2VrczpMaXN0Tm9kZWdyb3VwcycsXHJcbiAgICAgICAgICAgICAgICAnZWtzOkRlc2NyaWJlVXBkYXRlJyxcclxuICAgICAgICAgICAgICAgICdla3M6VXBkYXRlTm9kZWdyb3VwQ29uZmlnJyxcclxuICAgICAgICAgICAgICAgICdlY3M6RGVzY3JpYmVTZXJ2aWNlcycsXHJcbiAgICAgICAgICAgICAgICAnZWtzOkRlc2NyaWJlQ2x1c3RlcicsXHJcbiAgICAgICAgICAgICAgICAnZWtzOkxpc3RDbHVzdGVycycsXHJcbiAgICAgICAgICAgICAgICAnZWNzOkxpc3RDbHVzdGVycydcclxuICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHZhciBjdXN0b21XaWRnZXRMYW1iZGFSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdjdXN0b21XaWRnZXRMYW1iZGFSb2xlJywge1xyXG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICB9KTtcclxuICAgICAgICBjdXN0b21XaWRnZXRMYW1iZGFSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KGN1c3RvbVdpZGdldFJlc291cmNlQ29udHJvbGxlclBvbGljeSk7XHJcblxyXG4gICAgICAgIHZhciBwZXRzaXRlQXBwbGljYXRpb25SZXNvdXJjZUNvbnRyb2xsZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdwZXRzaXRlLWFwcGxpY2F0aW9uLXJlc291cmNlLWNvbnRyb2xlcicsIHtcclxuICAgICAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcvLi4vcmVzb3VyY2VzL3Jlc291cmNlLWNvbnRyb2xsZXItd2lkZ2V0JykpLFxyXG4gICAgICAgICAgICBoYW5kbGVyOiAncGV0c2l0ZS1hcHBsaWNhdGlvbi1yZXNvdXJjZS1jb250cm9sZXIubGFtYmRhX2hhbmRsZXInLFxyXG4gICAgICAgICAgICBtZW1vcnlTaXplOiAxMjgsXHJcbiAgICAgICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzksXHJcbiAgICAgICAgICAgIHJvbGU6IGN1c3RvbVdpZGdldExhbWJkYVJvbGUsXHJcbiAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLm1pbnV0ZXMoMTApXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgcGV0c2l0ZUFwcGxpY2F0aW9uUmVzb3VyY2VDb250cm9sbGVyLmFkZEVudmlyb25tZW50KFwiRUtTX0NMVVNURVJfTkFNRVwiLCBjbHVzdGVyLmNsdXN0ZXJOYW1lKTtcclxuICAgICAgICBwZXRzaXRlQXBwbGljYXRpb25SZXNvdXJjZUNvbnRyb2xsZXIuYWRkRW52aXJvbm1lbnQoXCJFQ1NfQ0xVU1RFUl9BUk5TXCIsIGVjc1BheUZvckFkb3B0aW9uQ2x1c3Rlci5jbHVzdGVyQXJuICsgXCIsXCIgK1xyXG4gICAgICAgICAgICBlY3NQZXRMaXN0QWRvcHRpb25DbHVzdGVyLmNsdXN0ZXJBcm4gKyBcIixcIiArIGVjc1BldFNlYXJjaENsdXN0ZXIuY2x1c3RlckFybik7XHJcblxyXG4gICAgICAgIHZhciBjdXN0b21XaWRnZXRGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ2Nsb3Vkd2F0Y2gtY3VzdG9tLXdpZGdldCcsIHtcclxuICAgICAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcvLi4vcmVzb3VyY2VzL3Jlc291cmNlLWNvbnRyb2xsZXItd2lkZ2V0JykpLFxyXG4gICAgICAgICAgICBoYW5kbGVyOiAnY2xvdWR3YXRjaC1jdXN0b20td2lkZ2V0LmxhbWJkYV9oYW5kbGVyJyxcclxuICAgICAgICAgICAgbWVtb3J5U2l6ZTogMTI4LFxyXG4gICAgICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM185LFxyXG4gICAgICAgICAgICByb2xlOiBjdXN0b21XaWRnZXRMYW1iZGFSb2xlLFxyXG4gICAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDYwKVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1c3RvbVdpZGdldEZ1bmN0aW9uLmFkZEVudmlyb25tZW50KFwiQ09OVFJPTEVSX0xBTUJEQV9BUk5cIiwgcGV0c2l0ZUFwcGxpY2F0aW9uUmVzb3VyY2VDb250cm9sbGVyLmZ1bmN0aW9uQXJuKTtcclxuICAgICAgICBjdXN0b21XaWRnZXRGdW5jdGlvbi5hZGRFbnZpcm9ubWVudChcIkVLU19DTFVTVEVSX05BTUVcIiwgY2x1c3Rlci5jbHVzdGVyTmFtZSk7XHJcbiAgICAgICAgY3VzdG9tV2lkZ2V0RnVuY3Rpb24uYWRkRW52aXJvbm1lbnQoXCJFQ1NfQ0xVU1RFUl9BUk5TXCIsIGVjc1BheUZvckFkb3B0aW9uQ2x1c3Rlci5jbHVzdGVyQXJuICsgXCIsXCIgK1xyXG4gICAgICAgICAgICBlY3NQZXRMaXN0QWRvcHRpb25DbHVzdGVyLmNsdXN0ZXJBcm4gKyBcIixcIiArIGVjc1BldFNlYXJjaENsdXN0ZXIuY2x1c3RlckFybik7XHJcblxyXG4gICAgICAgIHZhciBjb3N0Q29udHJvbERhc2hib2FyZEJvZHkgPSByZWFkRmlsZVN5bmMoXCIuL3Jlc291cmNlcy9jd19kYXNoYm9hcmRfY29zdF9jb250cm9sLmpzb25cIiwgXCJ1dGYtOFwiKTtcclxuICAgICAgICBjb3N0Q29udHJvbERhc2hib2FyZEJvZHkgPSBjb3N0Q29udHJvbERhc2hib2FyZEJvZHkucmVwbGFjZUFsbChcInt7WU9VUl9MQU1CREFfQVJOfX1cIiwgY3VzdG9tV2lkZ2V0RnVuY3Rpb24uZnVuY3Rpb25Bcm4pO1xyXG5cclxuICAgICAgICBjb25zdCBwZXRTaXRlQ29zdENvbnRyb2xEYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5DZm5EYXNoYm9hcmQodGhpcywgXCJQZXRTaXRlQ29zdENvbnRyb2xEYXNoYm9hcmRcIiwge1xyXG4gICAgICAgICAgICBkYXNoYm9hcmROYW1lOiBgUGV0U2l0ZV9Db3N0X0NvbnRyb2xfRGFzaGJvYXJkXyR7cmVnaW9ufWAsXHJcbiAgICAgICAgICAgIGRhc2hib2FyZEJvZHk6IGNvc3RDb250cm9sRGFzaGJvYXJkQm9keVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGluZyBBV1MgUmVzb3VyY2UgR3JvdXAgZm9yIGFsbCB0aGUgcmVzb3VyY2VzIG9mIHN0YWNrLlxyXG4gICAgICAgIGNvbnN0IHNlcnZpY2VzQ2ZuR3JvdXAgPSBuZXcgcmVzb3VyY2Vncm91cHMuQ2ZuR3JvdXAodGhpcywgJ1NlcnZpY2VzQ2ZuR3JvdXAnLCB7XHJcbiAgICAgICAgICAgIG5hbWU6IHN0YWNrTmFtZSxcclxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb250YWlucyBhbGwgdGhlIHJlc291cmNlcyBkZXBsb3llZCBieSBDbG91ZGZvcm1hdGlvbiBTdGFjayAnICsgc3RhY2tOYW1lLFxyXG4gICAgICAgICAgICByZXNvdXJjZVF1ZXJ5OiB7XHJcbiAgICAgICAgICAgICAgICB0eXBlOiAnQ0xPVURGT1JNQVRJT05fU1RBQ0tfMV8wJyxcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIC8vIEVuYWJsaW5nIENsb3VkV2F0Y2ggQXBwbGljYXRpb24gSW5zaWdodHMgZm9yIFJlc291cmNlIEdyb3VwXHJcbiAgICAgICAgY29uc3Qgc2VydmljZXNDZm5BcHBsaWNhdGlvbiA9IG5ldyBhcHBsaWNhdGlvbmluc2lnaHRzLkNmbkFwcGxpY2F0aW9uKHRoaXMsICdTZXJ2aWNlc0FwcGxpY2F0aW9uSW5zaWdodHMnLCB7XHJcbiAgICAgICAgICAgIHJlc291cmNlR3JvdXBOYW1lOiBzZXJ2aWNlc0Nmbkdyb3VwLm5hbWUsXHJcbiAgICAgICAgICAgIGF1dG9Db25maWd1cmF0aW9uRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICAgICAgY3dlTW9uaXRvckVuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgICAgIG9wc0NlbnRlckVuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgLy8gQWRkaW5nIGRlcGVuZGVuY3kgdG8gY3JlYXRlIHRoZXNlIHJlc291cmNlcyBhdCBsYXN0XHJcbiAgICAgICAgc2VydmljZXNDZm5Hcm91cC5ub2RlLmFkZERlcGVuZGVuY3kocGV0U2l0ZUNvc3RDb250cm9sRGFzaGJvYXJkKTtcclxuICAgICAgICBzZXJ2aWNlc0NmbkFwcGxpY2F0aW9uLm5vZGUuYWRkRGVwZW5kZW5jeShzZXJ2aWNlc0Nmbkdyb3VwKTtcclxuICAgICAgICAvLyBBZGRpbmcgYSBMYW1iZGEgZnVuY3Rpb24gdG8gcHJvZHVjZSB0aGUgZXJyb3JzIC0gbWFudWFsbHkgZXhlY3V0ZWRcclxuICAgICAgICB2YXIgZHluYW1vZGJRdWVyeUxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ2R5bmFtb2RiUXVlcnlMYW1iZGFSb2xlJywge1xyXG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tTWFuYWdlZFBvbGljeUFybih0aGlzLCAnbWFuYWdlZGR5bmFtb2RicmVhZCcsICdhcm46YXdzOmlhbTo6YXdzOnBvbGljeS9BbWF6b25EeW5hbW9EQlJlYWRPbmx5QWNjZXNzJyksXHJcbiAgICAgICAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tTWFuYWdlZFBvbGljeUFybih0aGlzLCAnbGFtYmRhQmFzaWNFeGVjUm9sZXRvZGRiJywgJ2Fybjphd3M6aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKVxyXG4gICAgICAgICAgICBdXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHZhciBkeW5hbW9kYlF1ZXJ5RnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdkeW5hbW9kYi1xdWVyeS1mdW5jdGlvbicsIHtcclxuICAgICAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcvLi4vcmVzb3VyY2VzL2FwcGxpY2F0aW9uLWluc2lnaHRzJykpLFxyXG4gICAgICAgICAgICBoYW5kbGVyOiAnZHluYW1vZGItcXVlcnktZnVuY3Rpb24ubGFtYmRhX2hhbmRsZXInLFxyXG4gICAgICAgICAgICBtZW1vcnlTaXplOiAxMjgsXHJcbiAgICAgICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzksXHJcbiAgICAgICAgICAgIHJvbGU6IGR5bmFtb2RiUXVlcnlMYW1iZGFSb2xlLFxyXG4gICAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDkwMClcclxuICAgICAgICB9KTtcclxuICAgICAgICBkeW5hbW9kYlF1ZXJ5RnVuY3Rpb24uYWRkRW52aXJvbm1lbnQoXCJEWU5BTU9EQl9UQUJMRV9OQU1FXCIsIGR5bmFtb2RiX3BldGFkb3B0aW9uLnRhYmxlTmFtZSk7XHJcblxyXG4gICAgICAgIHRoaXMuY3JlYXRlT3VwdXRzKG5ldyBNYXAoT2JqZWN0LmVudHJpZXMoe1xyXG4gICAgICAgICAgICAnQ1dTZXJ2aWNlQWNjb3VudEFybic6IGN3c2VydmljZWFjY291bnQucm9sZUFybixcclxuICAgICAgICAgICAgJ05ldHdvcmtGbG93TW9uaXRvclNlcnZpY2VBY2NvdW50QXJuJzogbmV0d29ya0Zsb3dNb25pdG9yUm9sZS5hdHRyQXJuLFxyXG4gICAgICAgICAgICAnWFJheVNlcnZpY2VBY2NvdW50QXJuJzogeHJheXNlcnZpY2VhY2NvdW50LnJvbGVBcm4sXHJcbiAgICAgICAgICAgICdPSURDUHJvdmlkZXJVcmwnOiBjbHVzdGVyLmNsdXN0ZXJPcGVuSWRDb25uZWN0SXNzdWVyVXJsLFxyXG4gICAgICAgICAgICAnT0lEQ1Byb3ZpZGVyQXJuJzogY2x1c3Rlci5vcGVuSWRDb25uZWN0UHJvdmlkZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyQXJuLFxyXG4gICAgICAgICAgICAnUGV0U2l0ZVVybCc6IGBodHRwOi8vJHthbGIubG9hZEJhbGFuY2VyRG5zTmFtZX1gLFxyXG4gICAgICAgICAgICAnRHluYW1vREJRdWVyeUZ1bmN0aW9uJzogZHluYW1vZGJRdWVyeUZ1bmN0aW9uLmZ1bmN0aW9uTmFtZVxyXG4gICAgICAgIH0pKSk7XHJcblxyXG5cclxuICAgICAgICBjb25zdCBwZXRBZG9wdGlvbnNTdGVwRm4gPSBuZXcgUGV0QWRvcHRpb25zU3RlcEZuKHRoaXMsICdTdGVwRm4nKTtcclxuXHJcbiAgICAgICAgdGhpcy5jcmVhdGVTc21QYXJhbWV0ZXJzKG5ldyBNYXAoT2JqZWN0LmVudHJpZXMoe1xyXG4gICAgICAgICAgICAnL3BldHN0b3JlL3RyYWZmaWNkZWxheXRpbWUnOiBcIjFcIixcclxuICAgICAgICAgICAgJy9wZXRzdG9yZS9ydW1zY3JpcHQnOiBcIiBcIixcclxuICAgICAgICAgICAgJy9wZXRzdG9yZS9wZXRhZG9wdGlvbnNzdGVwZm5hcm4nOiBwZXRBZG9wdGlvbnNTdGVwRm4uc3RlcEZuLnN0YXRlTWFjaGluZUFybixcclxuICAgICAgICAgICAgJy9wZXRzdG9yZS91cGRhdGVhZG9wdGlvbnN0YXR1c3VybCc6IHN0YXR1c1VwZGF0ZXJTZXJ2aWNlLmFwaS51cmwsXHJcbiAgICAgICAgICAgICcvcGV0c3RvcmUvcXVldWV1cmwnOiBzcXNRdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgICAgICAgJy9wZXRzdG9yZS9zbnNhcm4nOiB0b3BpY19wZXRhZG9wdGlvbi50b3BpY0FybixcclxuICAgICAgICAgICAgJy9wZXRzdG9yZS9keW5hbW9kYnRhYmxlbmFtZSc6IGR5bmFtb2RiX3BldGFkb3B0aW9uLnRhYmxlTmFtZSxcclxuICAgICAgICAgICAgJy9wZXRzdG9yZS9zM2J1Y2tldG5hbWUnOiBzM19vYnNlcnZhYmlsaXR5cGV0YWRvcHRpb25zLmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgICAgICcvcGV0c3RvcmUvc2VhcmNoYXBpdXJsJzogYGh0dHA6Ly8ke3NlYXJjaFNlcnZpY2Uuc2VydmljZS5sb2FkQmFsYW5jZXIubG9hZEJhbGFuY2VyRG5zTmFtZX0vYXBpL3NlYXJjaD9gLFxyXG4gICAgICAgICAgICAnL3BldHN0b3JlL3NlYXJjaGltYWdlJzogc2VhcmNoU2VydmljZS5jb250YWluZXIuaW1hZ2VOYW1lLFxyXG4gICAgICAgICAgICAnL3BldHN0b3JlL3BldGxpc3RhZG9wdGlvbnN1cmwnOiBgaHR0cDovLyR7bGlzdEFkb3B0aW9uc1NlcnZpY2Uuc2VydmljZS5sb2FkQmFsYW5jZXIubG9hZEJhbGFuY2VyRG5zTmFtZX0vYXBpL2Fkb3B0aW9ubGlzdC9gLFxyXG4gICAgICAgICAgICAnL3BldHN0b3JlL3BldGxpc3RhZG9wdGlvbnNtZXRyaWNzdXJsJzogYGh0dHA6Ly8ke2xpc3RBZG9wdGlvbnNTZXJ2aWNlLnNlcnZpY2UubG9hZEJhbGFuY2VyLmxvYWRCYWxhbmNlckRuc05hbWV9L21ldHJpY3NgLFxyXG4gICAgICAgICAgICAnL3BldHN0b3JlL3BheW1lbnRhcGl1cmwnOiBgaHR0cDovLyR7cGF5Rm9yQWRvcHRpb25TZXJ2aWNlLnNlcnZpY2UubG9hZEJhbGFuY2VyLmxvYWRCYWxhbmNlckRuc05hbWV9L2FwaS9ob21lL2NvbXBsZXRlYWRvcHRpb25gLFxyXG4gICAgICAgICAgICAnL3BldHN0b3JlL3BheWZvcmFkb3B0aW9ubWV0cmljc3VybCc6IGBodHRwOi8vJHtwYXlGb3JBZG9wdGlvblNlcnZpY2Uuc2VydmljZS5sb2FkQmFsYW5jZXIubG9hZEJhbGFuY2VyRG5zTmFtZX0vbWV0cmljc2AsXHJcbiAgICAgICAgICAgICcvcGV0c3RvcmUvY2xlYW51cGFkb3B0aW9uc3VybCc6IGBodHRwOi8vJHtwYXlGb3JBZG9wdGlvblNlcnZpY2Uuc2VydmljZS5sb2FkQmFsYW5jZXIubG9hZEJhbGFuY2VyRG5zTmFtZX0vYXBpL2hvbWUvY2xlYW51cGFkb3B0aW9uc2AsXHJcbiAgICAgICAgICAgICcvcGV0c3RvcmUvcGV0c2VhcmNoLWNvbGxlY3Rvci1tYW51YWwtY29uZmlnJzogcmVhZEZpbGVTeW5jKFwiLi9yZXNvdXJjZXMvY29sbGVjdG9yL2Vjcy14cmF5LW1hbnVhbC55YW1sXCIsIFwidXRmOFwiKSxcclxuICAgICAgICAgICAgJy9wZXRzdG9yZS9yZHNzZWNyZXRhcm4nOiBgJHthdXJvcmFDbHVzdGVyLnNlY3JldD8uc2VjcmV0QXJufWAsXHJcbiAgICAgICAgICAgICcvcGV0c3RvcmUvcmRzZW5kcG9pbnQnOiBhdXJvcmFDbHVzdGVyLmNsdXN0ZXJFbmRwb2ludC5ob3N0bmFtZSxcclxuICAgICAgICAgICAgJy9wZXRzdG9yZS9yZHMtcmVhZGVyLWVuZHBvaW50JzogYXVyb3JhQ2x1c3Rlci5jbHVzdGVyUmVhZEVuZHBvaW50Lmhvc3RuYW1lLFxyXG4gICAgICAgICAgICAnL3BldHN0b3JlL3N0YWNrbmFtZSc6IHN0YWNrTmFtZSxcclxuICAgICAgICAgICAgJy9wZXRzdG9yZS9wZXRzaXRldXJsJzogYGh0dHA6Ly8ke2FsYi5sb2FkQmFsYW5jZXJEbnNOYW1lfWAsXHJcbiAgICAgICAgICAgICcvcGV0c3RvcmUvcGV0aGlzdG9yeXVybCc6IGBodHRwOi8vJHthbGIubG9hZEJhbGFuY2VyRG5zTmFtZX0vcGV0YWRvcHRpb25zaGlzdG9yeWAsXHJcbiAgICAgICAgICAgICcvZWtzL3BldHNpdGUvT0lEQ1Byb3ZpZGVyVXJsJzogY2x1c3Rlci5jbHVzdGVyT3BlbklkQ29ubmVjdElzc3VlclVybCxcclxuICAgICAgICAgICAgJy9la3MvcGV0c2l0ZS9PSURDUHJvdmlkZXJBcm4nOiBjbHVzdGVyLm9wZW5JZENvbm5lY3RQcm92aWRlci5vcGVuSWRDb25uZWN0UHJvdmlkZXJBcm4sXHJcbiAgICAgICAgICAgICcvcGV0c3RvcmUvZXJyb3Jtb2RlMSc6IFwiZmFsc2VcIlxyXG4gICAgICAgIH0pKSk7XHJcblxyXG4gICAgICAgIHRoaXMuY3JlYXRlT3VwdXRzKG5ldyBNYXAoT2JqZWN0LmVudHJpZXMoe1xyXG4gICAgICAgICAgICAnUXVldWVVUkwnOiBzcXNRdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgICAgICAgJ1VwZGF0ZUFkb3B0aW9uU3RhdHVzdXJsJzogc3RhdHVzVXBkYXRlclNlcnZpY2UuYXBpLnVybCxcclxuICAgICAgICAgICAgJ1NOU1RvcGljQVJOJzogdG9waWNfcGV0YWRvcHRpb24udG9waWNBcm4sXHJcbiAgICAgICAgICAgICdSRFNTZXJ2ZXJOYW1lJzogYXVyb3JhQ2x1c3Rlci5jbHVzdGVyRW5kcG9pbnQuaG9zdG5hbWVcclxuICAgICAgICB9KSkpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgY3JlYXRlU3NtUGFyYW1ldGVycyhwYXJhbXM6IE1hcDxzdHJpbmcsIHN0cmluZz4pIHtcclxuICAgICAgICBwYXJhbXMuZm9yRWFjaCgodmFsdWUsIGtleSkgPT4ge1xyXG4gICAgICAgICAgICAvL2NvbnN0IGlkID0ga2V5LnJlcGxhY2UoJy8nLCAnXycpO1xyXG4gICAgICAgICAgICBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCBrZXksIHsgcGFyYW1ldGVyTmFtZToga2V5LCBzdHJpbmdWYWx1ZTogdmFsdWUgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBjcmVhdGVPdXB1dHMocGFyYW1zOiBNYXA8c3RyaW5nLCBzdHJpbmc+KSB7XHJcbiAgICAgICAgcGFyYW1zLmZvckVhY2goKHZhbHVlLCBrZXkpID0+IHtcclxuICAgICAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLCBrZXksIHsgdmFsdWU6IHZhbHVlIH0pXHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbn1cclxuIl19